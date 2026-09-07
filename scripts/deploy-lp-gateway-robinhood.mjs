#!/usr/bin/env node
// Pure-Privy deploy of the LP Gateway mock rig on Robinhood Chain testnet (46630).
//
// NO RAW KEY ANYWHERE: the Privy ROOT server wallet signs every deploy tx (contract creation + V4 pool
// init + wiring). That wallet becomes the gateway owner + harvestRecipient, so the same seat that runs
// the harvest/deploy crons stands the rig up. Fund it with testnet gas from the faucet first.
//
// Prereqs:
//   1. A Privy root server wallet — run  node scripts/provision-privy-oracle-wallet.mjs  (prints the id+addr).
//   2. Fund ROOT_ORACLE_PRIVY_ADDRESS with gas at https://faucet.testnet.chain.robinhood.com/
//   3. forge build  (so contracts-v4/out/ artifacts exist — mocks + gateway).
//
// Usage (from repo root):
//   ORACLE_SIGNER_PROVIDER=privy PRIVY_APP_ID=... PRIVY_APP_SECRET=... \
//   ROOT_ORACLE_PRIVY_WALLET_ID=... ROOT_ORACLE_PRIVY_ADDRESS=0x... \
//   node scripts/deploy-lp-gateway-robinhood.mjs
//
// Optional env: LP_GATEWAY_RPC_URL (default RH testnet), LP_GATEWAY_CHAIN_ID (default 46630),
//   LP_TICK_LOWER/LP_TICK_UPPER (default ±22980, multiples of 60), LP_MAX_DEVIATION_BPS (default 500),
//   LP_GATEWAY_YIELD_SOURCE (an existing ERC-4626 over the quote asset; default = deploy MockERC4626),
//   LP_ADAPTER_PER_BLOCK_CAP (adapter per-block withdraw bound, atomic units; default uncapped).
//
// It prints the exact Vercel env block (LP_GATEWAY_*) to paste after a successful run.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPublicClient, createWalletClient, http, formatEther } from 'viem'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'contracts-v4', 'out')

// ── Robinhood + V4 config (V4 verified byte-identical to canonical; same addrs testnet+mainnet) ──
const CHAIN_ID = Number(process.env.LP_GATEWAY_CHAIN_ID ?? 46630)
const RPC = process.env.LP_GATEWAY_RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com'
const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951'
const POSITION_MANAGER = '0x58daec3116aae6D93017bAAea7749052E8a04fA7'
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const ZERO = '0x0000000000000000000000000000000000000000'
const TICK_LOWER = Number(process.env.LP_TICK_LOWER ?? -22980)
const TICK_UPPER = Number(process.env.LP_TICK_UPPER ?? 22980)
const MAX_DEV_BPS = Number(process.env.LP_MAX_DEVIATION_BPS ?? 500) // clamped-follower per-block step (H-03)
const FEE = 3000
const TICK_SPACING = 60
const SQRT_PRICE_1 = 79228162514264337593543950336n // Q96 = sqrtPrice for tick 0 (price 1.0)
const MINT_USDG = 1_000_000n * 10n ** 6n // 1M tUSDG (6dp)
const MINT_PONS = 1_000_000n * 10n ** 18n // 1M tPONS (18dp)

function die(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function artifact(name, file = name) {
  let raw
  try {
    raw = readFileSync(join(OUT, `${file}.sol`, `${name}.json`), 'utf8')
  } catch {
    die(`missing artifact ${file}.sol/${name}.json — run \`forge build\` first (from repo root).`)
  }
  const j = JSON.parse(raw)
  const bytecode = j.bytecode?.object
  if (!Array.isArray(j.abi) || typeof bytecode !== 'string') die(`bad artifact shape for ${name}`)
  return { abi: j.abi, bytecode }
}

const POOL_MANAGER_ABI = [
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'initialize',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'sqrtPriceX96', type: 'uint160' },
    ],
    outputs: [{ name: 'tick', type: 'int24' }],
  },
]

// ── preflight: Privy env ──
const { PRIVY_APP_ID, PRIVY_APP_SECRET } = process.env
// The gateway owner is the DEDICATED `gateway` signer seat (re-audit A-3 key hardening) — the same wallet
// the app's crons resolve via getOracleSigner('gateway'). ROOT_* is accepted as a legacy fallback only.
const walletId = process.env.GATEWAY_ORACLE_PRIVY_WALLET_ID ?? process.env.ROOT_ORACLE_PRIVY_WALLET_ID
const privyAddress = process.env.GATEWAY_ORACLE_PRIVY_ADDRESS ?? process.env.ROOT_ORACLE_PRIVY_ADDRESS
if ((process.env.ORACLE_SIGNER_PROVIDER ?? '').toLowerCase() !== 'privy') {
  die('set ORACLE_SIGNER_PROVIDER=privy (this deploy is Privy-signed by design — no raw key).')
}
if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) die('missing PRIVY_APP_ID / PRIVY_APP_SECRET.')
if (!walletId || !privyAddress) {
  die('missing GATEWAY_ORACLE_PRIVY_WALLET_ID / GATEWAY_ORACLE_PRIVY_ADDRESS — run provision-privy-oracle-wallet.mjs first.')
}

let PrivyClient, createViemAccount
try {
  ;({ PrivyClient } = await import('@privy-io/server-auth'))
  ;({ createViemAccount } = await import('@privy-io/server-auth/viem'))
} catch {
  die('@privy-io/server-auth not installed — run `pnpm add @privy-io/server-auth`.')
}

const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
const account = await createViemAccount({ walletId, address: privyAddress, privy })

const chain = {
  id: CHAIN_ID,
  name: `robinhood-${CHAIN_ID}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
}
const pub = createPublicClient({ chain, transport: http(RPC) })
const wallet = createWalletClient({ account, chain, transport: http(RPC) })

// chain preflight (I-02) — a mismatched RPC / chain id must NEVER deploy to the wrong network.
const cid = await pub.getChainId()
if (cid !== CHAIN_ID) {
  die(`RPC chain id ${cid} != expected ${CHAIN_ID} — LP_GATEWAY_RPC_URL / LP_GATEWAY_CHAIN_ID mismatch; refusing to deploy.`)
}

// dependency preflight (I-02) — every external contract we call must actually exist on this chain.
// A zero-code address (wrong network, or a typo'd constant) would otherwise silently mis-deploy.
for (const [label, addr] of [
  ['POOL_MANAGER', POOL_MANAGER],
  ['POSITION_MANAGER', POSITION_MANAGER],
  ['PERMIT2', PERMIT2],
]) {
  const code = await pub.getBytecode({ address: addr })
  if (!code || code === '0x') {
    die(`${label} ${addr} has no on-chain code on chain ${CHAIN_ID} — wrong address or wrong network; refusing to deploy.`)
  }
}

// gas preflight — fail early with a clear faucet nudge rather than mid-deploy
const bal = await pub.getBalance({ address: privyAddress })
console.log(`\nPrivy signer: ${privyAddress}  ·  gas balance: ${formatEther(bal)}`)
if (bal === 0n) die(`signer has 0 gas on chain ${CHAIN_ID} — fund it at https://faucet.testnet.chain.robinhood.com/`)
if (TICK_LOWER % TICK_SPACING !== 0 || TICK_UPPER % TICK_SPACING !== 0) {
  die(`ticks must be multiples of ${TICK_SPACING} (got ${TICK_LOWER}/${TICK_UPPER}).`)
}

async function deploy(label, name, file, args) {
  const { abi, bytecode } = artifact(name, file)
  const hash = await wallet.deployContract({ abi, bytecode, args, account, chain })
  const rcpt = await pub.waitForTransactionReceipt({ hash })
  if (rcpt.status !== 'success' || !rcpt.contractAddress) die(`${label} deploy reverted (${hash})`)
  console.log(`  ${label.padEnd(30)} ${rcpt.contractAddress}`)
  return rcpt.contractAddress
}

async function send(label, params) {
  const hash = await wallet.writeContract({ account, chain, ...params })
  const rcpt = await pub.waitForTransactionReceipt({ hash })
  if (rcpt.status !== 'success') die(`${label} reverted (${hash})`)
  console.log(`  ✓ ${label}`)
}

console.log(`\nDeploying LP Gateway mock rig on Robinhood chain ${CHAIN_ID} …\n`)

// 1) mock tokens + the PRODUCTION yield adapter over a 4626 source.
// Re-audit A-5: the previous rig used `MockYieldAdapter`, whose `withdraw` had NO access control — anyone
// could drain the staged reserve. The rig now runs `MintwareERC4626YieldAdapter` (onlyVault, one-time
// setVault, best-effort fee-net exits) — the exact contract a real deployment uses — in front of a 4626
// source: `LP_GATEWAY_YIELD_SOURCE` if set (must be a 4626 over tUSDG), else a fresh `MockERC4626` (OZ
// ERC-4626; no test-only drain path). Mainnet = the real Paxos USDG + the curated Morpho vault here.
const usdg = await deploy('MockERC20 tUSDG', 'MockERC20', 'MockERC20', ['USD Global', 'USDG', 6])
const pons = await deploy('MockERC20 tPONS', 'MockERC20', 'MockERC20', ['Pons', 'PONS', 18])
let yieldSource = process.env.LP_GATEWAY_YIELD_SOURCE
if (yieldSource) {
  const code = await pub.getBytecode({ address: yieldSource })
  if (!code || code === '0x') die(`LP_GATEWAY_YIELD_SOURCE ${yieldSource} has no code on chain ${CHAIN_ID}.`)
  const srcAsset = await pub.readContract({
    address: yieldSource, functionName: 'asset',
    abi: [{ type: 'function', stateMutability: 'view', name: 'asset', inputs: [], outputs: [{ type: 'address' }] }],
  })
  if (srcAsset.toLowerCase() !== usdg.toLowerCase()) {
    die(`LP_GATEWAY_YIELD_SOURCE asset() ${srcAsset} != quote ${usdg} — a mis-wired source mis-accounts funds; refusing.`)
  }
  console.log(`  ${'yield source (env)'.padEnd(30)} ${yieldSource}`)
} else {
  yieldSource = await deploy('MockERC4626 yield source', 'MockERC4626', 'MockERC4626', [usdg])
}
// vault = 0 at construction (the staging doesn't exist yet); wired ONCE in step 4. Owner = the Privy signer.
const adapter = await deploy('ERC4626YieldAdapter', 'MintwareERC4626YieldAdapter', 'MintwareERC4626YieldAdapter', [
  usdg, yieldSource, ZERO, privyAddress,
])

// 2) fresh hookless V4 pool (sorted currencies, 0.30% / spacing 60, price 1.0)
const [c0, c1] = usdg.toLowerCase() < pons.toLowerCase() ? [usdg, pons] : [pons, usdg]
const poolKey = { currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: ZERO }
await send('initialize V4 pool', { address: POOL_MANAGER, abi: POOL_MANAGER_ABI, functionName: 'initialize', args: [poolKey, SQRT_PRICE_1] })

// 3) staging + position manager (owner + harvestRecipient = the Privy signer)
const staging = await deploy('LpGatewayStaging', 'MintwareLpGatewayStaging', 'MintwareLpGatewayStaging', [usdg, adapter])
const pm = await deploy('LpGatewayPositionManager', 'MintwareLpGatewayPositionManager', 'MintwareLpGatewayPositionManager', [
  POOL_MANAGER, POSITION_MANAGER, PERMIT2, poolKey, usdg, TICK_LOWER, TICK_UPPER, staging, privyAddress, privyAddress, MAX_DEV_BPS,
])

// 4) wire controller (deployer-only setController — the Privy signer deployed the staging, so this passes)
//    + wire the adapter's ONE-TIME vault to the staging (A-5) — until this lands every deposit fails closed
//    (OnlyVault); after it, the staging is the only address that can ever move funds through the adapter.
const stagingArt = artifact('MintwareLpGatewayStaging')
const adapterArt = artifact('MintwareERC4626YieldAdapter')
await send('staging.setController(pm)', { address: staging, abi: stagingArt.abi, functionName: 'setController', args: [pm] })
await send('adapter.setVault(staging)', { address: adapter, abi: adapterArt.abi, functionName: 'setVault', args: [staging] })
const perBlockCap = process.env.LP_ADAPTER_PER_BLOCK_CAP // optional drain bound, atomic units (0/unset = uncapped)
if (perBlockCap && BigInt(perBlockCap) > 0n) {
  await send(`adapter.setPerBlockWithdrawCap(${perBlockCap})`, {
    address: adapter, abi: adapterArt.abi, functionName: 'setPerBlockWithdrawCap', args: [BigInt(perBlockCap)],
  })
}

// 4b) post-wire assertions — the two trust edges of the rig must read back exactly as intended.
const wiredVault = await pub.readContract({ address: adapter, abi: adapterArt.abi, functionName: 'vault' })
const wiredController = await pub.readContract({ address: staging, abi: stagingArt.abi, functionName: 'controller' })
if (wiredVault.toLowerCase() !== staging.toLowerCase()) die(`adapter.vault() ${wiredVault} != staging ${staging}`)
if (wiredController.toLowerCase() !== pm.toLowerCase()) die(`staging.controller() ${wiredController} != pm ${pm}`)
console.log('  ✓ adapter.vault == staging · staging.controller == pm')

// 5) fund the signer with mock tokens to exercise deposit + the manual paired leg on deploy()
const erc20 = artifact('MockERC20').abi
await send('mint tUSDG → signer', { address: usdg, abi: erc20, functionName: 'mint', args: [privyAddress, MINT_USDG] })
await send('mint tPONS → signer', { address: pons, abi: erc20, functionName: 'mint', args: [privyAddress, MINT_PONS] })

console.log('\n✓ LP Gateway rig live on Robinhood testnet.\n')
console.log('Paste into Vercel (Production + Preview):')
console.log(`  LP_GATEWAY_POSITION_MANAGER = ${pm}`)
console.log(`  LP_GATEWAY_STAGING          = ${staging}`)
console.log(`  LP_GATEWAY_POOL_ADDRESS     = pons-usdg`)
console.log(`  LP_GATEWAY_CHAIN_ID         = ${CHAIN_ID}`)
console.log(`  LP_GATEWAY_RPC_URL          = ${RPC}`)
console.log('\nMock rig addresses (testnet, no value):')
console.log(`  tUSDG   = ${usdg}`)
console.log(`  tPONS        = ${pons}`)
console.log(`  yield source = ${yieldSource}`)
console.log(`  adapter      = ${adapter}  (MintwareERC4626YieldAdapter — onlyVault=staging)`)
console.log('\nNext: apply the migration, then deposit → deploy → harvest per the runbook.\n')

#!/usr/bin/env node
// Pure-Privy MAINNET deploy of the LP Gateway V1 on Robinhood Chain (4663) against the REAL Paxos USDG, a
// REAL curated ERC-4626 (Morpho) yield source, and an EXISTING, curated, hookless Uniswap V4 pool.
//
// Differences from the testnet script (scripts/deploy-lp-gateway-robinhood.mjs) — all deliberate:
//   • NO mock tokens, NO mints, NO pool initialize. The pool MUST pre-exist; USDG / pool / yield source come
//     from env and are verified on-chain by the read-only preflight, which runs FIRST and blocks the deploy
//     on any FAIL (scripts/preflight-lp-gateway-mainnet.mjs).
//   • The signer is the DEDICATED `gateway` Privy seat (GATEWAY_ORACLE_PRIVY_*) — never the shared root
//     (re-audit A-3 key hardening). No ROOT_* fallback here.
//   • harvestRecipient may be a separate cold address (LP_GATEWAY_HARVEST_RECIPIENT); default = the signer.
//   • Post-wire assertions read back EVERY trust edge, and `poke()` is proven callable via eth_call.
//   • `--dry-run` simulates every deploy via eth_estimateGas (constructor checks included) against the
//     signer's predicted contract addresses and sends NOTHING.
//
// What it stands up (3 contracts, 2–3 wiring txs):
//   MintwareERC4626YieldAdapter(USDG, source, vault=0, owner=signer)
//     → MintwareLpGatewayStaging(USDG, adapter)
//     → MintwareLpGatewayPositionManager(PoolManager, PositionManager, Permit2, poolKey, USDG, tickLower,
//         tickUpper, staging, owner=signer, harvestRecipient, band=LP_MAX_DEVIATION_BPS (default 500))
//     → staging.setController(pm) · adapter.setVault(staging) · [adapter.setPerBlockWithdrawCap(cap)]
//
// Usage (repo root; secrets ONLY via an env file, never on the command line):
//   export PATH="$HOME/.foundry/bin:$PATH" && pnpm forge:build       # fresh artifacts (checked below)
//   node --env-file=.env.lp-gateway-mainnet scripts/deploy-lp-gateway-mainnet.mjs --dry-run
//   node --env-file=.env.lp-gateway-mainnet scripts/deploy-lp-gateway-mainnet.mjs
//   pnpm deploy:lp-gateway:mainnet [-- --dry-run]
//
// Env (see docs/developers/lp-gateway-mainnet-runbook.md for the full table):
//   ORACLE_SIGNER_PROVIDER=privy · PRIVY_APP_ID · PRIVY_APP_SECRET · GATEWAY_ORACLE_PRIVY_WALLET_ID ·
//   GATEWAY_ORACLE_PRIVY_ADDRESS · LP_GATEWAY_USDG · LP_GATEWAY_YIELD_SOURCE · LP_GATEWAY_POOL_ID (or the
//   explicit LP_GATEWAY_POOL_CURRENCY0/1 + FEE + TICK_SPACING) · LP_GATEWAY_MIN_POOL_LIQUIDITY ·
//   [LP_GATEWAY_MIN_POOL_USDG] · [LP_GATEWAY_HARVEST_RECIPIENT] · [LP_TICK_LOWER / LP_TICK_UPPER] ·
//   [LP_MAX_DEVIATION_BPS] · [LP_ADAPTER_PER_BLOCK_CAP] · [LP_GATEWAY_RPC_URL]
//
// It does NOT edit config/deployments.json — the operator records the real addresses after the run.

import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  createPublicClient, createWalletClient, http, formatEther, encodeDeployData, encodeFunctionData, getContractAddress,
  getAddress,
} from 'viem'
import {
  runPreflight, POOL_MANAGER, POSITION_MANAGER, PERMIT2, ZERO, RH_MAINNET_CHAIN_ID, RH_MAINNET_RPC, PAXOS_USDG_RH_MAINNET,
  poolIdOf,
} from './preflight-lp-gateway-mainnet.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'contracts-v4', 'out')
const SRC = join(ROOT, 'contracts-v4', 'src')

const DRY_RUN = process.argv.includes('--dry-run')
const ALLOW_STALE = process.argv.includes('--allow-stale-artifacts')

function die(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

// ── artifacts (+ freshness: a stale `out/` would deploy yesterday's bytecode with today's audit fixes missing) ──
function artifact(name, srcRel) {
  const file = join(OUT, `${name}.sol`, `${name}.json`)
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    die(`missing artifact ${name}.sol/${name}.json — run \`pnpm forge:build\` first (from repo root).`)
  }
  const j = JSON.parse(raw)
  const bytecode = j.bytecode?.object
  if (!Array.isArray(j.abi) || typeof bytecode !== 'string' || bytecode.length < 10) die(`bad artifact shape for ${name}`)
  const srcPath = join(SRC, srcRel)
  try {
    const srcM = statSync(srcPath).mtimeMs
    const outM = statSync(file).mtimeMs
    if (srcM > outM) {
      const msg = `${srcRel} is NEWER than its artifact — run \`pnpm forge:build\` (or pass --allow-stale-artifacts if you know why).`
      if (!ALLOW_STALE) die(msg)
      console.warn(`  ! ${msg}`)
    }
  } catch {
    /* source missing (unlikely) — the artifact is what deploys */
  }
  return { abi: j.abi, bytecode }
}
const ADAPTER = artifact('MintwareERC4626YieldAdapter', 'vaults/MintwareERC4626YieldAdapter.sol')
const STAGING = artifact('MintwareLpGatewayStaging', 'gateway/MintwareLpGatewayStaging.sol')
const PM = artifact('MintwareLpGatewayPositionManager', 'gateway/MintwareLpGatewayPositionManager.sol')
// the round-2 audit surface MUST be in the bytecode we ship — a pre-fix artifact is a silent regression
for (const fn of ['poke', 'depositWithMin', 'withdrawWithMin', 'deployedPrincipal', 'MAX_DEPLOY_BPS', 'setPaused', 'compoundQuote']) {
  if (!PM.abi.some((x) => x.type === 'function' && x.name === fn)) die(`PositionManager artifact lacks \`${fn}\` — stale build (pre round-2 audit). Run \`pnpm forge:build\`.`)
}

// ── signer: the dedicated `gateway` Privy seat, no root fallback (A-3) ──
const { PRIVY_APP_ID, PRIVY_APP_SECRET, GATEWAY_ORACLE_PRIVY_WALLET_ID: walletId, GATEWAY_ORACLE_PRIVY_ADDRESS: signerRaw } = process.env
if ((process.env.ORACLE_SIGNER_PROVIDER ?? '').toLowerCase() !== 'privy') die('set ORACLE_SIGNER_PROVIDER=privy — this deploy is Privy-signed by design (no raw key).')
if (!walletId || !signerRaw) die('missing GATEWAY_ORACLE_PRIVY_WALLET_ID / GATEWAY_ORACLE_PRIVY_ADDRESS — the dedicated gateway seat (never ROOT_*).')
if (process.env.ROOT_ORACLE_PRIVY_ADDRESS && process.env.ROOT_ORACLE_PRIVY_ADDRESS.toLowerCase() === signerRaw.toLowerCase()) {
  die('GATEWAY_ORACLE_PRIVY_ADDRESS equals ROOT_ORACLE_PRIVY_ADDRESS — the gateway owner must be a SEPARATE seat from the shared card/x402 root (A-3).')
}
const signer = getAddress(signerRaw)
if (!DRY_RUN && (!PRIVY_APP_ID || !PRIVY_APP_SECRET)) die('missing PRIVY_APP_ID / PRIVY_APP_SECRET.')

// ── chain ──
const CHAIN_ID = Number(process.env.LP_GATEWAY_CHAIN_ID ?? RH_MAINNET_CHAIN_ID)
const RPC = process.env.LP_GATEWAY_RPC_URL ?? RH_MAINNET_RPC
if (CHAIN_ID !== RH_MAINNET_CHAIN_ID) die(`this script deploys to Robinhood Chain MAINNET (${RH_MAINNET_CHAIN_ID}) only; LP_GATEWAY_CHAIN_ID=${CHAIN_ID}. Use deploy-lp-gateway-robinhood.mjs for testnet.`)
const chain = {
  id: CHAIN_ID,
  name: 'robinhood-mainnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
}
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 60_000 }) })

console.log(`\nLP Gateway V1 — MAINNET ${DRY_RUN ? 'DRY-RUN (no transactions will be sent)' : 'DEPLOY'} · Robinhood Chain ${CHAIN_ID}`)
console.log(`signer (gateway seat): ${signer}\n`)

// ── 1. preflight FIRST — the deploy never proceeds past a FAIL ──
const pre = await runPreflight(process.env)
if (!pre.ok) {
  if (!DRY_RUN) die('preflight FAILED — refusing to deploy. Fix every FAIL row and re-run.')
  console.warn('!! PREFLIGHT FAILED — the dry-run continues for SIMULATION ONLY; a real deploy stops here. Exit code will be 1.\n')
}
const { poolKey, tickLower, tickUpper, paired, quoteIsCurrency0 } = pre.resolved
if (!poolKey || tickLower == null || tickUpper == null) die('preflight could not resolve the pool key / tick range — nothing to deploy.')
const USDG = getAddress(process.env.LP_GATEWAY_USDG ?? PAXOS_USDG_RH_MAINNET) // preflight already asserted == Paxos
const SOURCE = getAddress(process.env.LP_GATEWAY_YIELD_SOURCE ?? '')
const HARVEST_RECIPIENT = getAddress(process.env.LP_GATEWAY_HARVEST_RECIPIENT ?? signer)
const BAND = Number(process.env.LP_MAX_DEVIATION_BPS ?? 500)
const PER_BLOCK_CAP = process.env.LP_ADAPTER_PER_BLOCK_CAP ? BigInt(process.env.LP_ADAPTER_PER_BLOCK_CAP) : 0n
const poolId = poolIdOf(poolKey)

console.log('Plan:')
console.log(`  USDG (quote)         ${USDG}`)
console.log(`  yield source (4626)  ${SOURCE}`)
console.log(`  pool                 ${poolKey.currency0} / ${poolKey.currency1} · fee ${poolKey.fee} · spacing ${poolKey.tickSpacing} · hooks ${poolKey.hooks}`)
console.log(`  poolId               ${poolId}`)
console.log(`  paired token         ${paired}  (USDG is currency${quoteIsCurrency0 ? '0' : '1'})`)
console.log(`  tick range           [${tickLower}, ${tickUpper}]`)
console.log(`  owner                ${signer}`)
console.log(`  harvestRecipient     ${HARVEST_RECIPIENT}${HARVEST_RECIPIENT === signer ? ' (= signer)' : ' (separate address)'}`)
console.log(`  maxDeviationBps      ${BAND}`)
console.log(`  adapter per-block cap ${PER_BLOCK_CAP === 0n ? 'uncapped' : PER_BLOCK_CAP.toString() + ' atomic'}\n`)

// ── 2. predicted addresses (CREATE from the signer's next nonces) — lets the dry-run simulate the PM constructor
//       with the real staging address, and lets a real run assert nothing else slipped in between. ──
const nonce0 = await pub.getTransactionCount({ address: signer, blockTag: 'pending' })
const predicted = {
  adapter: getContractAddress({ from: signer, nonce: BigInt(nonce0) }),
  staging: getContractAddress({ from: signer, nonce: BigInt(nonce0 + 1) }),
  pm: getContractAddress({ from: signer, nonce: BigInt(nonce0 + 2) }),
}
console.log(`Predicted addresses (signer nonce ${nonce0}):`)
console.log(`  adapter ${predicted.adapter}\n  staging ${predicted.staging}\n  pm      ${predicted.pm}\n`)

const adapterArgs = [USDG, SOURCE, ZERO, signer]
const stagingArgs = (adapter) => [USDG, adapter]
const pmArgs = (staging) => [POOL_MANAGER, POSITION_MANAGER, PERMIT2, poolKey, USDG, tickLower, tickUpper, staging, signer, HARVEST_RECIPIENT, BAND]

// ── 3. dry-run: eth_estimateGas each creation (runs the constructors — AssetMismatch / HookedPoolUnsupported /
//       BadTicks / ZeroAddress all surface here) + print the wiring calldata. Sends nothing. ──
if (DRY_RUN) {
  let allSimOk = true
  const sim = async (label, abi, bytecode, args) => {
    try {
      const gas = await pub.estimateGas({ account: signer, data: encodeDeployData({ abi, bytecode, args }) })
      console.log(`  ✓ ${label.padEnd(34)} constructor OK · est. gas ${gas}`)
    } catch (e) {
      allSimOk = false
      console.log(`  ✗ ${label.padEnd(34)} ${String(e?.shortMessage ?? e?.message ?? e).split('\n')[0]}`)
    }
  }
  console.log('Simulating contract creations (eth_estimateGas from the signer):')
  await sim('MintwareERC4626YieldAdapter', ADAPTER.abi, ADAPTER.bytecode, adapterArgs)
  // staging + pm constructors reference the not-yet-existing predecessors: the staging ctor only stores the
  // adapter; the pm ctor only stores staging — neither calls into them, so simulation against predicted
  // addresses is faithful.
  await sim('MintwareLpGatewayStaging', STAGING.abi, STAGING.bytecode, stagingArgs(predicted.adapter))
  await sim('MintwareLpGatewayPositionManager', PM.abi, PM.bytecode, pmArgs(predicted.staging))
  console.log('\nWiring transactions that WOULD be sent (calldata, not simulated — targets do not exist yet):')
  console.log(`  ${predicted.staging} ← staging.setController(${predicted.pm})`)
  console.log(`     ${encodeFunctionData({ abi: STAGING.abi, functionName: 'setController', args: [predicted.pm] })}`)
  console.log(`  ${predicted.adapter} ← adapter.setVault(${predicted.staging})`)
  console.log(`     ${encodeFunctionData({ abi: ADAPTER.abi, functionName: 'setVault', args: [predicted.staging] })}`)
  if (PER_BLOCK_CAP > 0n) {
    console.log(`  ${predicted.adapter} ← adapter.setPerBlockWithdrawCap(${PER_BLOCK_CAP})`)
    console.log(`     ${encodeFunctionData({ abi: ADAPTER.abi, functionName: 'setPerBlockWithdrawCap', args: [PER_BLOCK_CAP] })}`)
  }
  const bal = await pub.getBalance({ address: signer })
  console.log(`\nSigner gas balance: ${formatEther(bal)} ETH`)
  printEnvBlock(predicted, '(PREDICTED — dry-run; real addresses come from the live run)')
  console.log(`\nDRY-RUN ${pre.ok && allSimOk ? 'CLEAN' : 'NOT CLEAN'} — nothing was sent.`)
  process.exit(pre.ok && allSimOk ? 0 : 1)
}

// ── 4. real run: Privy-signed ──
let PrivyClient, createViemAccount
try {
  ;({ PrivyClient } = await import('@privy-io/server-auth'))
  ;({ createViemAccount } = await import('@privy-io/server-auth/viem'))
} catch {
  die('@privy-io/server-auth not installed — run `pnpm add @privy-io/server-auth`.')
}
// O-6: pass the seat's wallet-API authorization key when the dashboard has one enabled for this wallet.
const authKey = process.env.GATEWAY_ORACLE_PRIVY_AUTH_KEY ?? ''
const privy = authKey
  ? new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET, { walletApi: { authorizationPrivateKey: authKey } })
  : new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
const account = await createViemAccount({ walletId, address: signer, privy })
const wallet = createWalletClient({ account, chain, transport: http(RPC, { timeout: 60_000 }) })

async function deploy(label, { abi, bytecode }, args, expectedAddr) {
  const hash = await wallet.deployContract({ abi, bytecode, args, account, chain })
  const rcpt = await pub.waitForTransactionReceipt({ hash })
  if (rcpt.status !== 'success' || !rcpt.contractAddress) die(`${label} deploy reverted (${hash})`)
  if (expectedAddr && rcpt.contractAddress.toLowerCase() !== expectedAddr.toLowerCase()) {
    console.warn(`  ! ${label} landed at ${rcpt.contractAddress}, predicted ${expectedAddr} (another tx from the signer interleaved) — continuing with the REAL address`)
  }
  console.log(`  ${label.padEnd(34)} ${rcpt.contractAddress}   tx ${hash}`)
  return getAddress(rcpt.contractAddress)
}
async function send(label, params) {
  const hash = await wallet.writeContract({ account, chain, ...params })
  const rcpt = await pub.waitForTransactionReceipt({ hash })
  if (rcpt.status !== 'success') die(`${label} reverted (${hash})`)
  console.log(`  ✓ ${label}   tx ${hash}`)
}
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args })
const assertEq = (label, got, want) => {
  const g = typeof got === 'string' ? got.toLowerCase() : String(got)
  const w = typeof want === 'string' ? want.toLowerCase() : String(want)
  if (g !== w) die(`post-wire assertion failed: ${label} — got ${got}, expected ${want}`)
  console.log(`  ✓ ${label} == ${want}`)
}

console.log('Deploying (3 contracts) …')
const adapter = await deploy('MintwareERC4626YieldAdapter', ADAPTER, adapterArgs, predicted.adapter)
const staging = await deploy('MintwareLpGatewayStaging', STAGING, stagingArgs(adapter), predicted.staging)
const pm = await deploy('MintwareLpGatewayPositionManager', PM, pmArgs(staging), predicted.pm)

console.log('\nWiring …')
await send('staging.setController(pm)', { address: staging, abi: STAGING.abi, functionName: 'setController', args: [pm] })
await send('adapter.setVault(staging)', { address: adapter, abi: ADAPTER.abi, functionName: 'setVault', args: [staging] })
if (PER_BLOCK_CAP > 0n) {
  await send(`adapter.setPerBlockWithdrawCap(${PER_BLOCK_CAP})`, { address: adapter, abi: ADAPTER.abi, functionName: 'setPerBlockWithdrawCap', args: [PER_BLOCK_CAP] })
}

console.log('\nPost-wire assertions (every trust edge read back from chain) …')
assertEq('adapter.vault()', await read(adapter, ADAPTER.abi, 'vault'), staging)
assertEq('adapter.asset()', await read(adapter, ADAPTER.abi, 'asset'), USDG)
assertEq('adapter.yieldSource()', await read(adapter, ADAPTER.abi, 'yieldSource'), SOURCE)
assertEq('adapter.owner()', await read(adapter, ADAPTER.abi, 'owner'), signer)
assertEq('adapter.perBlockWithdrawCap()', await read(adapter, ADAPTER.abi, 'perBlockWithdrawCap'), PER_BLOCK_CAP)
assertEq('staging.controller()', await read(staging, STAGING.abi, 'controller'), pm)
assertEq('staging.deployer()', await read(staging, STAGING.abi, 'deployer'), signer)
assertEq('pm.quoteAsset()', await read(pm, PM.abi, 'quoteAsset'), USDG)
assertEq('pm.pairedAsset()', await read(pm, PM.abi, 'pairedAsset'), paired)
assertEq('pm.staging()', await read(pm, PM.abi, 'staging'), staging)
assertEq('pm.owner()', await read(pm, PM.abi, 'owner'), signer)
assertEq('pm.harvestRecipient()', await read(pm, PM.abi, 'harvestRecipient'), HARVEST_RECIPIENT)
assertEq('pm.MAX_DEPLOY_BPS()', await read(pm, PM.abi, 'MAX_DEPLOY_BPS'), 5000)
assertEq('pm.maxDeviationBps()', await read(pm, PM.abi, 'maxDeviationBps'), BAND)
assertEq('pm.deployedPrincipal()', await read(pm, PM.abi, 'deployedPrincipal'), 0n)
assertEq('pm.tokenId()', await read(pm, PM.abi, 'tokenId'), 0n)
assertEq('pm.paused()', await read(pm, PM.abi, 'paused'), false)
assertEq('pm.tickLower()', await read(pm, PM.abi, 'tickLower'), tickLower)
assertEq('pm.tickUpper()', await read(pm, PM.abi, 'tickUpper'), tickUpper)
assertEq('pm.quoteIsCurrency0()', await read(pm, PM.abi, 'quoteIsCurrency0'), quoteIsCurrency0)
assertEq('pm.poolManager()', await read(pm, PM.abi, 'poolManager'), POOL_MANAGER)
const onchainKey = await read(pm, PM.abi, 'poolKey')
assertEq('poolId(pm.poolKey())', poolIdOf({ currency0: onchainKey.currency0, currency1: onchainKey.currency1, fee: Number(onchainKey.fee), tickSpacing: Number(onchainKey.tickSpacing), hooks: onchainKey.hooks }), poolId)
assertEq('pm.totalNav()', await read(pm, PM.abi, 'totalNav'), 0n)
try {
  await pub.simulateContract({ address: pm, abi: PM.abi, functionName: 'poke', account: signer })
  console.log('  ✓ pm.poke() callable (eth_call)')
} catch (e) {
  die(`pm.poke() simulation failed: ${String(e?.shortMessage ?? e)}`)
}

console.log('\n✓ LP Gateway V1 deployed + wired on Robinhood Chain MAINNET. Idle only — no deposits, no position yet.\n')
printEnvBlock({ adapter, staging, pm }, '')
console.log(`
config/deployments.json → "robinhood-mainnet" (record by hand; the script never edits it):
${JSON.stringify({
  'robinhood-mainnet': {
    LpGatewayPositionManager: { address: pm, chainId: CHAIN_ID, status: 'mainnet-bounded', note: `LP Gateway V1 mainnet instance — pool ${poolId} (${poolKey.currency0}/${poolKey.currency1} fee ${poolKey.fee} spacing ${poolKey.tickSpacing}), quote USDG ${USDG}, ticks [${tickLower}, ${tickUpper}], band ${BAND}, owner=gateway seat ${signer}, harvestRecipient ${HARVEST_RECIPIENT}. UNAUDITED externally — bounded OWN funds only per docs/developers/lp-gateway-mainnet-runbook.md.`, verified: new Date().toISOString().slice(0, 10) },
    LpGatewayStaging: { address: staging, chainId: CHAIN_ID, status: 'mainnet-bounded', note: `controller=PositionManager; deployer=gateway seat ${signer}; the adapter's one-time vault.`, verified: new Date().toISOString().slice(0, 10) },
    LpGateway_ERC4626YieldAdapter: { address: adapter, chainId: CHAIN_ID, status: 'mainnet-bounded', note: `MintwareERC4626YieldAdapter over ${SOURCE} (asset USDG). onlyVault=staging (set once); per-block cap ${PER_BLOCK_CAP === 0n ? 'uncapped' : PER_BLOCK_CAP.toString()}; owner=gateway seat.`, verified: new Date().toISOString().slice(0, 10) },
  },
}, null, 2)}
`)
console.log('Next: runbook §4 (record) → §5 (Vercel env) → §6 (tiny smoke) — never skip the smoke.\n')

function printEnvBlock(a, suffix) {
  console.log(`Vercel env (Production + Preview) ${suffix}:`)
  console.log(`  LP_GATEWAY_CHAIN_ID          = ${CHAIN_ID}`)
  console.log(`  LP_GATEWAY_RPC_URL           = ${RPC}`)
  console.log(`  LP_GATEWAY_USDG              = ${USDG}`)
  console.log(`  LP_GATEWAY_POSITION_MANAGER  = ${a.pm}`)
  console.log(`  LP_GATEWAY_STAGING           = ${a.staging}`)
  console.log(`  LP_GATEWAY_POOL_ADDRESS      = ${poolId}`)
  console.log(`  LP_GATEWAY_YIELD_SOURCE      = ${SOURCE}`)
  console.log(`  LP_GATEWAY_HARVEST_DESTINATION = restake`)
  console.log(`  GATEWAY_ORACLE_PRIVY_WALLET_ID = <the gateway seat's Privy wallet id>`)
  console.log(`  GATEWAY_ORACLE_PRIVY_ADDRESS   = ${signer}`)
  console.log(`  (keep LP_GATEWAY_DEPLOY_ENABLED / LP_GATEWAY_HARVEST_ENABLED / LP_GATEWAY_CIRCUIT_BREAKER_ENABLED unset until the smoke passes — runbook §6–§7)`)
}

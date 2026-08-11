// POST /api/oracle/deploy-pair-full-testnet   (route group (admin) is stripped from the URL)
//
// One-click TESTNET deploy of the FULL World-B DeFi stack — the "bundle MEV + rewards" path —
// to Base Sepolia, signed by the Privy server wallet (getOracleSigner('root')). This SUPERSEDES
// deploy-pair-testnet, which ships a STATIC-fee pool with no rewards + no MEV (the vault deployed
// 2026-08-10 at 0x89324aac… is that static, empty, unwired instance — abandon it; redeploy here).
//
// Deploys + fully wires, in one run:
//   • MWHookCoordinator (mined 0xAC8) — vault-only LP gate + am-AMM fee override
//   • MintwareDeFiPairVault (USDC/WETH) on a **DYNAMIC-FEE** pool
//   • MWAmAuction — am-AMM MEV recapture, wired as the pool's rent source (→ LPs)
//   • Rail B rewards — reuse an existing MintwareWeightedDistributor, register the pair DUAL-sided
//
// Two correctness deltas vs. deploy-pair-testnet that are REQUIRED once MEV is on:
//   1. DYNAMIC-FEE POOL. The am-AMM returns `fee | OVERRIDE_FEE_FLAG` in beforeSwap; V4 only honours
//      a hook fee override when the pool was initialized with fee == DYNAMIC_FEE_FLAG. A static pool
//      + managed swap = revert. (This is exactly why the afternoon's static pool can't host MEV.)
//   2. RENT-SINK WIRING. MWAmAuction pushes rent via IAmAmmRentSink.fundRent to the LP; the vault's
//      fundRent gates on msg.sender == rentFunder, so vault.setRentFunder(auction) + the auction's
//      configurePool rentSink = vault.
//
// ⚠ NOT YET FIRED ON-CHAIN. Fork-simulate the deposit→swap→skim→fundRent sequence GREEN before the
// first broadcast (the am-AMM enable gate). Requires ORACLE_SIGNER_PROVIDER=privy + a funded wallet.
// Bearer-gated (CRON_SECRET). TESTNET ONLY (Base Sepolia hardcoded).

import {
  createPublicClient, createWalletClient, http,
  encodeAbiParameters, keccak256, concat, toHex, toBytes, slice, getAddress,
} from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { HOOK_COORDINATOR_ABI, HOOK_COORDINATOR_BYTECODE } from '@/lib/web3/artifacts/hookCoordinator'
import { PAIR_VAULT_ABI, PAIR_VAULT_BYTECODE } from '@/lib/web3/artifacts/pairVault'
import { AM_AUCTION_ABI, AM_AUCTION_BYTECODE } from '@/lib/web3/artifacts/amAuction'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const POOL_MANAGER = '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408' as const // Base Sepolia V4 PoolManager
const C2_FACTORY   = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as const // canonical CREATE2 factory
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const WETH = '0x4200000000000000000000000000000000000006' as const         // Base WETH9 predeploy
const ZERO = '0x0000000000000000000000000000000000000000' as const
// Reuse the weighted distributor deployed 2026-08-10 (owner == this Privy wallet, so registerVault
// bypasses the registrar allowlist). Override with WEIGHTED_DIST_ADDRESS to deploy/point elsewhere.
const DEFAULT_WEIGHTED_DIST = '0x8cb41291b336e0ee6a4703c5cf18fbda04fa9ed2' as const

const HOOK_FLAGS = 0xac8n
const HOOK_MASK  = 0x3fffn                                                  // ALL_HOOK_MASK = (1<<14)-1
const MAX_LOOP   = 160_000
const PROFILE_EMERGING = 1
const DYNAMIC_FEE = 0x800000                                               // LPFeeLibrary.DYNAMIC_FEE_FLAG
const TICK_SPACING = 60
const SQRT_PRICE_1_1 = 79228162514264337593543950336n

// am-AMM economic params (testnet defaults — TUNE for mainnet). K≈7200 ≈ 4h @ Base ~2s blocks.
const AMAMM = {
  enabled:        true,
  bidToken:       USDC,      // rent + refund currency (must be a pool token)
  feeMaxPips:     30_000,    // 3% cap on manager fee
  defaultFeePips: 3_000,     // 0.30% when no manager
  minRent:        1_000_000n, // 1 USDC/block floor (6-decimals) — TUNE
  K:              7_200,
  minBidMultBps:  11_000,    // 1.1x
} as const

// Inline ABI fragments for setters the minimal artifacts don't include (leaves proven artifacts untouched).
const EXTRA_ABI = [
  { type: 'function', name: 'setAuction', stateMutability: 'nonpayable', inputs: [{ name: '_auction', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setAmAmmEnabled', stateMutability: 'nonpayable', inputs: [{ name: 'poolId', type: 'bytes32' }, { name: 'enabled', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'setRentFunder', stateMutability: 'nonpayable', inputs: [{ name: '_funder', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setWeightedDistributor', stateMutability: 'nonpayable', inputs: [{ name: 'dist', type: 'address' }, { name: 'vaultId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'setAuthorizedRegistrar', stateMutability: 'nonpayable', inputs: [{ name: 'registrar', type: 'address' }, { name: 'ok', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'authorizedRegistrar', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
] as const

/** Mirror HookMiner.find: mine salt so the CREATE2 hook address matches the permission bits.
 *  Starts from a RANDOM offset so each deploy mines a DISTINCT hook address → distinct PoolId.
 *  A fixed start yields the same hook every run, so a re-run collides with an already-initialized
 *  pool (PoolAlreadyInitialized, 0x7983c051). Testnet: a fresh, independent stack per call. */
function mineHookSalt(initcode: `0x${string}`): { salt: `0x${string}`; hook: `0x${string}` } | null {
  const initcodeHash = keccak256(initcode)
  const start = Math.floor(Math.random() * 1_000_000_000)
  for (let i = 0; i < MAX_LOOP; i++) {
    const salt = toHex(BigInt(start + i), { size: 32 })
    const addr = getAddress(slice(keccak256(concat(['0xff', C2_FACTORY, salt, initcodeHash])), 12))
    if ((BigInt(addr) & HOOK_MASK) === HOOK_FLAGS) return { salt, hook: addr }
  }
  return null
}

/** V4 PoolId.toId() = keccak256(abi.encode(poolKey)). */
function computePoolId(currency0: `0x${string}`, currency1: `0x${string}`, hook: `0x${string}`): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [{ type: 'tuple', components: [
      { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
    ] }],
    [{ currency0, currency1, fee: DYNAMIC_FEE, tickSpacing: TICK_SPACING, hooks: hook }],
  ))
}

export const POST = createHandler(async (_req, ctx) => {
  const account = await getOracleSigner('root') // the Privy wallet
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport })
  const weightedDist = (process.env.WEIGHTED_DIST_ADDRESS || DEFAULT_WEIGHTED_DIST) as `0x${string}`

  if ((await publicClient.getBalance({ address: account.address })) === 0n) {
    return ctx.json({ ok: false, step: 'preflight', deployer: account.address,
      error: `Deployer ${account.address} holds 0 Base Sepolia ETH — fund it, then retry.` }, 400)
  }
  if (AMAMM.bidToken !== USDC && AMAMM.bidToken !== WETH) {
    return ctx.json({ ok: false, step: 'preflight', error: 'AMAMM.bidToken must be a pool token' }, 400)
  }

  const [currency0, currency1] = BigInt(USDC) < BigInt(WETH) ? [USDC, WETH] : [WETH, USDC]

  // 1. Mine + CREATE2-deploy the hook (vault=0 at deploy, wired below).
  const hookArgs = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    [POOL_MANAGER, ZERO, account.address],
  )
  const initcode = concat([HOOK_COORDINATOR_BYTECODE, hookArgs])
  const mined = mineHookSalt(initcode)
  if (!mined) return ctx.json({ ok: false, step: 'mine', error: 'no hook salt within MAX_LOOP' }, 500)

  let hookDeployTx: `0x${string}` | 'reused-existing' = 'reused-existing'
  const preExisting = await publicClient.getBytecode({ address: mined.hook })
  if (!preExisting || preExisting === '0x') {
    hookDeployTx = await walletClient.sendTransaction({
      account, chain: baseSepolia, to: C2_FACTORY, data: concat([mined.salt, initcode]),
    })
    await publicClient.waitForTransactionReceipt({ hash: hookDeployTx })
  }
  let hookCode = await publicClient.getBytecode({ address: mined.hook })
  for (let i = 0; i < 8 && (!hookCode || hookCode === '0x'); i++) {
    await new Promise((r) => setTimeout(r, 1000))
    hookCode = await publicClient.getBytecode({ address: mined.hook })
  }
  if (!hookCode || hookCode === '0x') {
    return ctx.json({ ok: false, step: 'hook-deploy', hook: mined.hook, hookDeployTx, error: 'no code at mined hook' }, 500)
  }

  // 2. Deploy the vault with a DYNAMIC-FEE PoolKey (delta #1 — required for the hook fee override).
  const poolKey = { currency0, currency1, fee: DYNAMIC_FEE, tickSpacing: TICK_SPACING, hooks: mined.hook }
  const vaultDeployTx = await walletClient.deployContract({
    abi: PAIR_VAULT_ABI, bytecode: PAIR_VAULT_BYTECODE, account, chain: baseSepolia,
    args: [POOL_MANAGER, poolKey, PROFILE_EMERGING, account.address, account.address, account.address],
  })
  const vaultRcpt = await publicClient.waitForTransactionReceipt({ hash: vaultDeployTx })
  const vault = vaultRcpt.contractAddress
  if (vaultRcpt.status !== 'success' || !vault) {
    return ctx.json({ ok: false, step: 'vault-deploy', vaultDeployTx, error: 'vault deploy reverted' }, 500)
  }

  // 3. Vault-only LP gate + open the dynamic-fee pool.
  const setVaultTx = await walletClient.writeContract({
    address: mined.hook, abi: HOOK_COORDINATOR_ABI, functionName: 'setVault', args: [vault], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setVaultTx })
  const initTx = await walletClient.writeContract({
    address: vault, abi: PAIR_VAULT_ABI, functionName: 'initializePool', args: [SQRT_PRICE_1_1], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: initTx })

  // 4. Rail B rewards. NOTE: vault.setWeightedDistributor ITSELF calls dist.registerVault(vaultId,
  //    token0, token1) dual-sided (MintwareDeFiPairVault.sol:393) — so do NOT pre-register here, or
  //    the internal call reverts VaultAlreadyRegistered (0x49d8266e). We only authorize the vault as
  //    a registrar first so its internal registerVault passes the distributor's allowlist.
  const dvid = keccak256(toBytes(`mw-pair-${vault}`))
  const authTx = await walletClient.writeContract({
    address: weightedDist, abi: EXTRA_ABI, functionName: 'setAuthorizedRegistrar', args: [vault, true], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: authTx })
  // Base Sepolia's public RPC lags read-after-write and load-balances across nodes with differing
  // lag. setWeightedDistributor's gas-estimation SIMULATES the vault's internal registerVault, which
  // reads authorizedRegistrar[vault] just set above — a stale read reverts NotAuthorizedRegistrar
  // (0x946d7b84). Poll until the authorize is visible, then send with EXPLICIT gas so viem skips
  // estimateGas entirely (the tx executes on-chain in nonce order, where the state is correct).
  for (let i = 0; i < 20; i++) {
    const seen = await publicClient
      .readContract({ address: weightedDist, abi: EXTRA_ABI, functionName: 'authorizedRegistrar', args: [vault] })
      .catch(() => false)
    if (seen) break
    await new Promise((r) => setTimeout(r, 1500))
  }
  const setWDistTx = await walletClient.writeContract({
    address: vault, abi: EXTRA_ABI, functionName: 'setWeightedDistributor', args: [weightedDist, dvid],
    account, chain: baseSepolia, gas: 600_000n,
  })
  await publicClient.waitForTransactionReceipt({ hash: setWDistTx })

  // 5. am-AMM MEV recapture — deploy + cross-wire + rent-sink (delta #2) + configure + enable.
  const auctionDeployTx = await walletClient.deployContract({
    abi: AM_AUCTION_ABI, bytecode: AM_AUCTION_BYTECODE, account, chain: baseSepolia, args: [account.address],
  })
  const auctionRcpt = await publicClient.waitForTransactionReceipt({ hash: auctionDeployTx })
  const auction = auctionRcpt.contractAddress
  if (auctionRcpt.status !== 'success' || !auction) {
    return ctx.json({ ok: false, step: 'auction-deploy', auctionDeployTx, error: 'auction deploy reverted' }, 500)
  }
  // Wait for the fresh auction's code to be visible on the (lagging) RPC before wiring it, so the
  // next writes' gas-estimation doesn't simulate against a node that doesn't have the contract yet.
  let auctionCode = await publicClient.getBytecode({ address: auction })
  for (let i = 0; i < 8 && (!auctionCode || auctionCode === '0x'); i++) {
    await new Promise((r) => setTimeout(r, 1000))
    auctionCode = await publicClient.getBytecode({ address: auction })
  }
  const poolId = computePoolId(currency0, currency1, mined.hook)

  const setCoordTx = await walletClient.writeContract({
    address: auction, abi: AM_AUCTION_ABI, functionName: 'setCoordinator', args: [mined.hook], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setCoordTx })
  const setAuctionTx = await walletClient.writeContract({
    address: mined.hook, abi: EXTRA_ABI, functionName: 'setAuction', args: [auction], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setAuctionTx })
  const setRentFunderTx = await walletClient.writeContract({
    address: vault, abi: EXTRA_ABI, functionName: 'setRentFunder', args: [auction], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setRentFunderTx })
  // AmParams tuple in ABI order: (enabled, bidToken, feeMaxPips, defaultFeePips, minRent, K, minBidMultBps)
  const configTx = await walletClient.writeContract({
    address: auction, abi: AM_AUCTION_ABI, functionName: 'configurePool',
    args: [poolId, vault, {
      enabled: AMAMM.enabled, bidToken: AMAMM.bidToken, feeMaxPips: AMAMM.feeMaxPips,
      defaultFeePips: AMAMM.defaultFeePips, minRent: AMAMM.minRent, K: AMAMM.K, minBidMultBps: AMAMM.minBidMultBps,
    }],
    account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: configTx })
  const setEnabledTx = await walletClient.writeContract({
    address: mined.hook, abi: EXTRA_ABI, functionName: 'setAmAmmEnabled', args: [poolId, AMAMM.enabled], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setEnabledTx })

  return ctx.json({
    ok: true,
    chain: 'base_sepolia',
    deployer: account.address,
    hook: mined.hook,
    vault,
    auction,
    weightedDistributor: weightedDist,
    rewardsVaultId: dvid,
    poolId,
    poolManager: POOL_MANAGER,
    currency0, currency1, fee: 'DYNAMIC', tickSpacing: TICK_SPACING,
    amAmm: AMAMM,
    txs: { hookDeployTx, vaultDeployTx, setVaultTx, initTx, authTx, setWDistTx,
           auctionDeployTx, setCoordTx, setAuctionTx, setRentFunderTx, configTx, setEnabledTx },
    basescanVault: `https://sepolia.basescan.org/address/${vault}`,
    note: 'Fork-simulate deposit→swap→skim→fundRent before trusting MEV. Set NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS = vault.',
  })
}, { auth: 'bearer-token' })

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
import { PAIR_VAULT_ABI, PAIR_VAULT_BYTECODE, PAIR_VAULT_LINK_REFS } from '@/lib/web3/artifacts/pairVault'
import { AM_AUCTION_ABI, AM_AUCTION_BYTECODE } from '@/lib/web3/artifacts/amAuction'
import { AAVE_ADAPTER_ABI, AAVE_ADAPTER_BYTECODE } from '@/lib/web3/artifacts/aaveAdapter'
import { MW_JIT_LIB_ABI, MW_JIT_LIB_BYTECODE } from '@/lib/web3/artifacts/mwJitLib'
import { MW_IDLE_LIB_ABI, MW_IDLE_LIB_BYTECODE } from '@/lib/web3/artifacts/mwIdleLib'
import { MW_POSITION_LIB_ABI, MW_POSITION_LIB_BYTECODE } from '@/lib/web3/artifacts/mwPositionLib'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const POOL_MANAGER = '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408' as const // Base Sepolia V4 PoolManager
const C2_FACTORY   = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as const // canonical CREATE2 factory
// USDC + WETH must be the AAVE-MARKET tokens on Base Sepolia so the yield adapters can supply them.
// (Was Circle's 0x036C… USDC — that token has no Aave reserve, so the adapter ctor's aToken check
//  would revert. The Aave-market USDC below has aUSDC 0x10F1…; WETH is the Base predeploy and is
//  ALSO the Aave-market WETH, so it is unchanged.)
const USDC = '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f' as const         // Aave v3 Base-Sepolia USDC
const WETH = '0x4200000000000000000000000000000000000006' as const         // Base WETH9 predeploy == Aave WETH
const ZERO = '0x0000000000000000000000000000000000000000' as const
// Aave v3 Base-Sepolia — VERIFIED addresses for the ULV idle-in-Aave engine.
const AAVE_PROVIDER = '0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00' as const // PoolAddressesProvider
const AUSDC = '0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC' as const         // aToken for USDC
const AWETH = '0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb' as const         // aToken for WETH
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

// ULV engine params (testnet defaults — TUNE for mainnet).
const ULV = {
  // Hot buffer kept in the live V4 position; remainder idles in Aave. bps of managed liquidity.
  bufferRatioBps: 2_000n,            // 20%
  // Vault-level JIT ceilings in OUTPUT-TOKEN units. NOTE: the pool's two tokens have different
  // decimals (WETH 18, USDC 6), so a single scalar cap can't be tight for both — it is a finite
  // belt-and-suspenders ceiling. Sized generous for the 18-dec (WETH) side; on the 6-dec (USDC)
  // side these raw values are effectively unbounded, and real bounding there comes from the
  // adapter's Aave headroom (maxWithdrawable) + the hot buffer. Adapter per-block withdraw caps
  // are left at 0 (unlimited) as instructed.
  jitMaxPerSwap:  50_000_000_000_000_000_000n,   // 50e18 (~50 WETH-equiv/swap)
  jitMaxPerBlock: 200_000_000_000_000_000_000n,  // 200e18
  // Global size gate: |amountSpecified| >= threshold triggers a JIT open. Low so testnet swaps fire.
  jitThreshold:   1_000_000n,        // 1e6 (any real WETH swap or >=1 USDC swap)
  // Deviation-priced dynamic (surge) fee — the unmanaged-block LVR recapture lever.
  baseFeePips:        3_000,         // 0.30% floor
  maxFeePips:         30_000,        // 3% ceiling
  slopePipsPerTick:   100n,          // +0.01%/tick of oracle deviation → hits 3% cap at 270 ticks
  maxFeeStepPerBlock: 0,             // no per-block fee rate-limit on testnet
  // Oracle circuit breaker left OFF: a fresh oracle at extreme deviation would revert swaps and
  // brick the testnet pool. These guard params are inert while guardEnabled=false.
  guardEnabled:         false,
  maxTickMovePerBlock:  500,
  maxDeviationTicks:    2_000,
  maxCatchupBlocks:     10,
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

/** Solidity library link-reference shape: sourcePath → { LibName → [{start,length}] } (byte offsets). */
type LinkRefs = Record<string, Record<string, ReadonlyArray<{ start: number; length: number }>>>
const HEX40 = /^[0-9a-fA-F]{40}$/
const PLACEHOLDER_RE = /__\$[0-9a-fA-F]{34}\$__/

/**
 * Splice each deployed library address into the vault's creation bytecode at every offset the compiler
 * recorded in `linkReferences`. Solidity leaves a 20-byte `__$<34-hex>$__` placeholder per call-site;
 * we overwrite exactly those 40 hex chars with the library address (lowercase, no `0x`, 40 chars).
 *  - `bytecode`  the raw `0x…` creation bytecode WITH placeholders.
 *  - `linkRefs`  the artifact's `.bytecode.linkReferences` (byte offsets — hex index = 2 + start*2).
 *  - `libAddrs`  LibName → deployed 0x-address.
 * Asserts every target slice is a placeholder (or already-linked 40-hex), that the address is known,
 * and that NO `__$…$__` placeholder survives. Throws on any mismatch — a bad splice bricks the vault.
 */
function linkBytecode(
  bytecode: `0x${string}`,
  linkRefs: LinkRefs,
  libAddrs: Record<string, `0x${string}`>,
): `0x${string}` {
  const origLen = bytecode.length
  let hex = bytecode.slice(2) // drop 0x; work in raw-hex index space (byte b → char 2*b)
  for (const [sourcePath, libs] of Object.entries(linkRefs)) {
    for (const [libName, occurrences] of Object.entries(libs)) {
      const addr = libAddrs[libName]
      if (!addr) throw new Error(`linkBytecode: no deployed address for library ${libName} (${sourcePath})`)
      const addrHex = addr.replace(/^0x/, '').toLowerCase()
      if (!HEX40.test(addrHex)) throw new Error(`linkBytecode: bad address for ${libName}: ${addr}`)
      for (const { start, length } of occurrences) {
        if (length !== 20) throw new Error(`linkBytecode: unexpected link length ${length} for ${libName} (want 20)`)
        const cs = start * 2            // char index of slice start within raw hex (no 0x)
        const ce = cs + length * 2      // 40 hex chars
        const slice = hex.slice(cs, ce)
        const isPlaceholder = slice.startsWith('__$') && slice.endsWith('$__')
        if (!isPlaceholder && !HEX40.test(slice)) {
          throw new Error(`linkBytecode: slice at byte ${start} for ${libName} is neither a __$ placeholder nor 40-hex: "${slice}"`)
        }
        hex = hex.slice(0, cs) + addrHex + hex.slice(ce)
      }
    }
  }
  const linked = (`0x${hex}`) as `0x${string}`
  const leftover = linked.match(PLACEHOLDER_RE)
  if (leftover) throw new Error(`linkBytecode: unresolved library placeholder remains after linking: ${leftover[0]}`)
  if (linked.length !== origLen) throw new Error(`linkBytecode: length changed ${origLen} → ${linked.length} (splice must be in-place)`)
  return linked
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

  // 1.5 Deploy the vault's THREE delegatecall libraries, then LINK their addresses into the vault's
  //     creation bytecode. The vault was refactored (EIP-170) so MWJitLib / MWIdleLib / MWPositionLib
  //     live in external libraries — its creation bytecode now carries unresolved `__$<hash>$__`
  //     placeholders, one per call-site. Deploying it raw would revert; we must splice the deployed
  //     library addresses into every offset first. Libraries take no constructor args.
  const deployLib = async (
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abi: any, bytecode: `0x${string}`,
  ): Promise<{ tx: `0x${string}`; addr: `0x${string}` | null }> => {
    const tx = await walletClient.deployContract({ abi, bytecode, account, chain: baseSepolia })
    const rcpt = await publicClient.waitForTransactionReceipt({ hash: tx })
    if (rcpt.status !== 'success' || !rcpt.contractAddress) return { tx, addr: null }
    // Poll for code visibility on the lagging RPC before the linked vault deploy simulates against it.
    let code = await publicClient.getBytecode({ address: rcpt.contractAddress })
    for (let i = 0; i < 8 && (!code || code === '0x'); i++) {
      await new Promise((r) => setTimeout(r, 1000))
      code = await publicClient.getBytecode({ address: rcpt.contractAddress })
    }
    ctx.log.info('deploy-pair-full', `${name} deployed`, { addr: rcpt.contractAddress, tx })
    return { tx, addr: rcpt.contractAddress }
  }

  const jitLib = await deployLib('MWJitLib', MW_JIT_LIB_ABI, MW_JIT_LIB_BYTECODE)
  if (!jitLib.addr) return ctx.json({ ok: false, step: 'jit-lib-deploy', jitLibDeployTx: jitLib.tx, error: 'MWJitLib deploy reverted' }, 500)
  const idleLib = await deployLib('MWIdleLib', MW_IDLE_LIB_ABI, MW_IDLE_LIB_BYTECODE)
  if (!idleLib.addr) return ctx.json({ ok: false, step: 'idle-lib-deploy', idleLibDeployTx: idleLib.tx, error: 'MWIdleLib deploy reverted' }, 500)
  const posLib = await deployLib('MWPositionLib', MW_POSITION_LIB_ABI, MW_POSITION_LIB_BYTECODE)
  if (!posLib.addr) return ctx.json({ ok: false, step: 'position-lib-deploy', posLibDeployTx: posLib.tx, error: 'MWPositionLib deploy reverted' }, 500)

  const jitLibAddr = jitLib.addr, idleLibAddr = idleLib.addr, posLibAddr = posLib.addr

  // Link (or, if an old placeholder-free artifact ever ships, skip and deploy raw).
  const placeholdersBefore = (PAIR_VAULT_BYTECODE.match(/__\$[0-9a-fA-F]{34}\$__/g) || []).length
  let linkedVaultBytecode: `0x${string}`
  if (placeholdersBefore === 0) {
    linkedVaultBytecode = PAIR_VAULT_BYTECODE
    ctx.log.info('deploy-pair-full', 'vault bytecode has no library placeholders — deploying raw (unlinked path)')
  } else {
    try {
      linkedVaultBytecode = linkBytecode(PAIR_VAULT_BYTECODE, PAIR_VAULT_LINK_REFS, {
        MWJitLib: jitLibAddr, MWIdleLib: idleLibAddr, MWPositionLib: posLibAddr,
      })
    } catch (e) {
      return ctx.json({ ok: false, step: 'vault-link', jitLib: jitLibAddr, idleLib: idleLibAddr, posLib: posLibAddr,
        error: e instanceof Error ? e.message : String(e) }, 500)
    }
    ctx.log.info('deploy-pair-full', 'linked vault bytecode', { placeholdersBefore, jitLib: jitLibAddr, idleLib: idleLibAddr, posLib: posLibAddr })
  }

  // 2. Deploy the vault (LINKED bytecode) with a DYNAMIC-FEE PoolKey (delta #1 — hook fee override).
  const poolKey = { currency0, currency1, fee: DYNAMIC_FEE, tickSpacing: TICK_SPACING, hooks: mined.hook }
  const vaultDeployTx = await walletClient.deployContract({
    abi: PAIR_VAULT_ABI, bytecode: linkedVaultBytecode, account, chain: baseSepolia,
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

  const poolId = computePoolId(currency0, currency1, mined.hook)

  // 3.5 ULV ENGINE — idle-in-Aave + size-gated JIT + deviation-priced surge fee.
  //     Deploy one Aave v3 yield adapter per token, authorize the vault on each, wire both into the
  //     vault (by currency slot), point the vault at the hook (JIT bridge), set the hot buffer + JIT
  //     caps, turn on the dynamic (surge) fee, and enroll the pool for size-gated JIT. Adapter ctor:
  //     (provider, asset, aToken, vault=0, owner) — no per-block-cap ctor arg (that is a separate
  //     setPerBlockWithdrawCap; left at 0 = unlimited here).
  const deployAdapter = async (asset: `0x${string}`, aToken: `0x${string}`) => {
    const tx = await walletClient.deployContract({
      abi: AAVE_ADAPTER_ABI, bytecode: AAVE_ADAPTER_BYTECODE, account, chain: baseSepolia,
      args: [AAVE_PROVIDER, asset, aToken, ZERO, account.address],
    })
    const rcpt = await publicClient.waitForTransactionReceipt({ hash: tx })
    if (rcpt.status !== 'success' || !rcpt.contractAddress) return { tx, addr: null as `0x${string}` | null }
    // Wait for the fresh adapter's code to be visible on the lagging RPC before wiring (so the next
    // writes' gas-estimation doesn't simulate against a node that doesn't have it yet).
    let code = await publicClient.getBytecode({ address: rcpt.contractAddress })
    for (let i = 0; i < 8 && (!code || code === '0x'); i++) {
      await new Promise((r) => setTimeout(r, 1000))
      code = await publicClient.getBytecode({ address: rcpt.contractAddress })
    }
    return { tx, addr: rcpt.contractAddress }
  }

  const usdcAd = await deployAdapter(USDC, AUSDC)
  if (!usdcAd.addr) return ctx.json({ ok: false, step: 'usdc-adapter-deploy', usdcAdapterDeployTx: usdcAd.tx, error: 'USDC adapter deploy reverted' }, 500)
  const wethAd = await deployAdapter(WETH, AWETH)
  if (!wethAd.addr) return ctx.json({ ok: false, step: 'weth-adapter-deploy', wethAdapterDeployTx: wethAd.tx, error: 'WETH adapter deploy reverted' }, 500)

  // Authorize the vault as the sole supply/withdraw caller on each adapter.
  const usdcSetVaultTx = await walletClient.writeContract({
    address: usdcAd.addr, abi: AAVE_ADAPTER_ABI, functionName: 'setVault', args: [vault], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: usdcSetVaultTx })
  const wethSetVaultTx = await walletClient.writeContract({
    address: wethAd.addr, abi: AAVE_ADAPTER_ABI, functionName: 'setVault', args: [vault], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: wethSetVaultTx })

  // Map adapters to the pool's currency0/currency1 slots. The vault sets token0=currency0,
  // token1=currency1 and setAdapters(a0,a1) verifies a0.asset()==token0, a1.asset()==token1.
  // (On Base Sepolia, WETH 0x4200… < USDC 0xba50… ⇒ currency0=WETH, currency1=USDC — but map by
  //  address so a re-ordering can never mis-wire the slots.)
  const adapter0 = getAddress(currency0) === getAddress(USDC) ? usdcAd.addr : wethAd.addr
  const adapter1 = getAddress(currency1) === getAddress(USDC) ? usdcAd.addr : wethAd.addr
  const setAdaptersTx = await walletClient.writeContract({
    address: vault, abi: PAIR_VAULT_ABI, functionName: 'setAdapters', args: [adapter0, adapter1], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setAdaptersTx })

  // Point the vault at the hook (the sole onlyHook caller of jitOpen).
  const setHookTx = await walletClient.writeContract({
    address: vault, abi: PAIR_VAULT_ABI, functionName: 'setHook', args: [mined.hook], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setHookTx })

  // Hot buffer + JIT ceilings.
  const setBufferTx = await walletClient.writeContract({
    address: vault, abi: PAIR_VAULT_ABI, functionName: 'setBufferRatio', args: [ULV.bufferRatioBps], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setBufferTx })
  const setJitCapsTx = await walletClient.writeContract({
    address: vault, abi: PAIR_VAULT_ABI, functionName: 'setJitCaps', args: [ULV.jitMaxPerSwap, ULV.jitMaxPerBlock], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setJitCapsTx })

  // Deviation-priced dynamic (surge) fee — makes the unmanaged-block LVR recapture active.
  // configurePool(poolId, baseFeePips, maxFeePips, slopePipsPerTick, maxFeeStepPerBlock,
  //               dynamicFeeEnabled, guardEnabled, maxTickMovePerBlock, maxDeviationTicks, maxCatchupBlocks)
  const configPoolTx = await walletClient.writeContract({
    address: mined.hook, abi: HOOK_COORDINATOR_ABI, functionName: 'configurePool',
    args: [poolId, ULV.baseFeePips, ULV.maxFeePips, ULV.slopePipsPerTick, ULV.maxFeeStepPerBlock,
           true, ULV.guardEnabled, ULV.maxTickMovePerBlock, ULV.maxDeviationTicks, ULV.maxCatchupBlocks],
    account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: configPoolTx })

  // Size gate + per-pool JIT enrollment (JIT never fires until this pool is explicitly allowlisted).
  const setJitThresholdTx = await walletClient.writeContract({
    address: mined.hook, abi: HOOK_COORDINATOR_ABI, functionName: 'setJitThreshold', args: [ULV.jitThreshold], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setJitThresholdTx })
  const setJitEnabledTx = await walletClient.writeContract({
    address: mined.hook, abi: HOOK_COORDINATOR_ABI, functionName: 'setJitEnabled', args: [poolId, true], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setJitEnabledTx })

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
    // Delegatecall libraries linked into the vault's creation bytecode before deploy.
    libraries: {
      linked: placeholdersBefore > 0,
      placeholdersLinked: placeholdersBefore,
      MWJitLib: jitLibAddr, MWIdleLib: idleLibAddr, MWPositionLib: posLibAddr,
    },
    amAmm: AMAMM,
    ulvEngine: {
      aaveProvider: AAVE_PROVIDER,
      usdcAdapter: usdcAd.addr, wethAdapter: wethAd.addr,
      adapter0, adapter1,             // aligned to currency0 / currency1
      usdc: USDC, aUsdc: AUSDC, weth: WETH, aWeth: AWETH,
      bufferRatioBps: ULV.bufferRatioBps,
      jitMaxPerSwap: ULV.jitMaxPerSwap, jitMaxPerBlock: ULV.jitMaxPerBlock, jitThreshold: ULV.jitThreshold,
      dynamicFee: { baseFeePips: ULV.baseFeePips, maxFeePips: ULV.maxFeePips, slopePipsPerTick: ULV.slopePipsPerTick,
                    guardEnabled: ULV.guardEnabled },
    },
    txs: { hookDeployTx,
           jitLibDeployTx: jitLib.tx, idleLibDeployTx: idleLib.tx, posLibDeployTx: posLib.tx,
           vaultDeployTx, setVaultTx, initTx,
           usdcAdapterDeployTx: usdcAd.tx, wethAdapterDeployTx: wethAd.tx, usdcSetVaultTx, wethSetVaultTx,
           setAdaptersTx, setHookTx, setBufferTx, setJitCapsTx, configPoolTx, setJitThresholdTx, setJitEnabledTx,
           authTx, setWDistTx,
           auctionDeployTx, setCoordTx, setAuctionTx, setRentFunderTx, configTx, setEnabledTx },
    basescanVault: `https://sepolia.basescan.org/address/${vault}`,
    note: 'Fork-simulate deposit→swap→skim→fundRent + idle→Aave→JIT before trusting MEV. Set NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS = vault.',
  })
}, { auth: 'bearer-token' })

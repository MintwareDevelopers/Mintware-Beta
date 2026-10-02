// V2-RWAs — PURE-PRIVY deploy of one demo RWA liquidity unit (Base Sepolia by default).
//
// Mirrors contracts-v4/script/DeployRwaLiquidityUnit.s.sol (the Forge version, used for fork rehearsals),
// but signs every transaction with the dedicated `rwa` Privy seat — no raw key anywhere. Deploys from the
// Forge artifacts in contracts-v4/out (run `forge build` first), links MWTreasuryPositionLib into the
// vault, mines the hook's CREATE2 salt so its address carries the permission bits, wires everything,
// posts the first appraisal, opens the pool AT it, and commits the issuer's junior.
//
// Writes the addresses to RWA_DEPLOYMENT_OUT (config/rwaDemo.deployment.json), which
// scripts/rwa-demo-lifecycle.mjs reads next.
//
// TESTNET ONLY: the RWA seat plays issuer, keeper and guardian; the property is fictional; tokens are valueless.
//
// Run:  node --env-file=.env.robinhood.local scripts/deploy-rwa-demo.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  createPublicClient, createWalletClient, http, defineChain, encodeAbiParameters, encodeDeployData,
  getContractAddress, keccak256, pad, toHex, concat, formatEther, parseUnits, getAddress,
} from 'viem'
import { resolveRwaSigner } from './lib/rwaSigner.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'contracts-v4', 'out')

const RPC = process.env.RWA_RPC_URL ?? 'https://sepolia.base.org'
const POOL_MANAGER = getAddress(process.env.V4_POOL_MANAGER ?? '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408')
const C2_FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C'
const HOOK_FLAGS = 0x2ac0n
const DEPLOYMENT_OUT = process.env.RWA_DEPLOYMENT_OUT ?? join(ROOT, 'config', 'rwaDemo.deployment.json')

const PROPERTY_NAME = process.env.PROPERTY_NAME ?? 'Willow Creek Parcel 7 (demo)'
const PROPERTY_SYMBOL = process.env.PROPERTY_SYMBOL ?? 'WCP7'
const TICK_ABS = Number(process.env.APPRAISAL_TICK_ABS ?? 230270) // ≈ $100 per 18-dp unit in 6-dp dUSD
const JUNIOR_TOKENS = parseUnits(process.env.JUNIOR_TOKENS ?? '5000', 18)
const JUNIOR_USD = parseUnits(process.env.JUNIOR_USD ?? '500', 6)
const LEND_APR_BPS = BigInt(process.env.LEND_APR_BPS ?? 450)

const CONFIG = { coreBandTicks: 300, specBandTicks: 1000, maxStepTicks: 500, minUpdateInterval: 600, maxAppraisalAge: 30 * 86400, coreFeePips: 3000, specFeePips: 10000, maxDriftTicksPerDay: 1000, oracleGraceSecs: 7 * 86400 }
const CONFIG_TUPLE = { type: 'tuple', components: [
  { name: 'coreBandTicks', type: 'uint24' }, { name: 'specBandTicks', type: 'uint24' }, { name: 'maxStepTicks', type: 'uint24' },
  { name: 'minUpdateInterval', type: 'uint32' }, { name: 'maxAppraisalAge', type: 'uint32' },
  { name: 'coreFeePips', type: 'uint24' }, { name: 'specFeePips', type: 'uint24' },
  { name: 'maxDriftTicksPerDay', type: 'uint24' }, { name: 'oracleGraceSecs', type: 'uint32' },
] }

const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1) }
const art = (file, name = file) => JSON.parse(readFileSync(join(OUT, `${file}.sol`, `${name}.json`), 'utf8'))

const { account, kind } = await resolveRwaSigner().catch((e) => die(e.message))
const chainId = await createPublicClient({ transport: http(RPC) }).getChainId()
const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const w = createWalletClient({ account, chain, transport: http(RPC) })
const me = account.address

console.log(`\nV2-RWAs demo deploy — chain ${chainId} — signer ${me} (${kind}) — gas ${formatEther(await pub.getBalance({ address: me }))} ETH`)
if ((await pub.getCode({ address: POOL_MANAGER }))?.length > 2 === false) die(`no PoolManager at ${POOL_MANAGER}`)

// ── resumable progress: every completed step is checkpointed, so a re-run skips what is already on-chain ──
const PROGRESS = `${DEPLOYMENT_OUT}.progress.json`
const progress = existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, 'utf8')) : { chainId, signer: me, steps: {} }
if (progress.chainId !== chainId || progress.signer !== me) die(`progress file ${PROGRESS} belongs to another chain/signer — move it aside`)
const checkpoint = () => writeFileSync(PROGRESS, JSON.stringify(progress, null, 2))

// Load-balanced RPCs can serve a read from a node one block behind the receipt. Retry reads/simulations.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function retry(fn, label, tries = 6) {
  for (let i = 1; ; i++) {
    try { return await fn() } catch (e) { if (i >= tries) die(`${label}: ${e.shortMessage ?? e.message}`); await sleep(2500) }
  }
}

const txs = progress.txs ?? (progress.txs = [])
progress.pending ??= {}

// Send a step EXACTLY ONCE across re-runs: the hash is checkpointed the moment it is broadcast, so a crash or
// a receipt timeout before confirmation resumes by waiting on THAT hash — never by sending the step again.
async function sendOnce(label, send) {
  let hash = progress.pending[label]
  if (hash) console.log(`  · ${label}: resuming, waiting on ${hash}`)
  else { hash = await send(); progress.pending[label] = hash; checkpoint() }
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 })
  if (r.status !== 'success') {
    txs.push({ label, hash, block: Number(r.blockNumber), status: 'reverted' }); delete progress.pending[label]; checkpoint()
    die(`${label} reverted (${hash})`)
  }
  txs.push({ label, hash, block: Number(r.blockNumber) })
  delete progress.pending[label]
  checkpoint()
  console.log(`  ✓ ${label}  ${hash}`)
  return r
}
async function deploy(label, a, args = [], bytecode = a.bytecode.object) {
  if (progress.steps[`deploy ${label}`]) { console.log(`  · ${label} already at ${progress.steps[`deploy ${label}`]}`); return progress.steps[`deploy ${label}`] }
  const r = await sendOnce(`deploy ${label}`, () => w.deployContract({ abi: a.abi, bytecode, args }))
  console.log(`      → ${r.contractAddress}`)
  progress.steps[`deploy ${label}`] = r.contractAddress
  checkpoint()
  return r.contractAddress
}
async function call(label, address, a, functionName, args = []) {
  if (progress.steps[label]) { console.log(`  · ${label} already done`); return }
  if (!progress.pending[label]) await retry(() => pub.simulateContract({ address, abi: a.abi, functionName, args, account }), label)
  const r = await sendOnce(label, () => w.writeContract({ address, abi: a.abi, functionName, args }))
  progress.steps[label] = r.transactionHash
  checkpoint()
  return r
}

const A = {
  usd: art('DemoUSD'), reg: art('MockRwaIdentityRegistry'), prop: art('MockPermissionedPropertyToken'),
  lend: art('DemoLendingAdapter'), hook: art('MintwareRwaAppraisalHook'), vault: art('MintwareTreasuryVault'),
  lib: art('MWTreasuryPositionLib'), router: art('DemoSwapRouter'),
  pm: { abi: [{ type: 'function', name: 'initialize', stateMutability: 'nonpayable', inputs: [{ name: 'key', type: 'tuple', components: [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { name: 'sqrtPriceX96', type: 'uint160' }], outputs: [{ type: 'int24' }] }] },
}

// 1) tokens, registry, simulated lending venue
const usd = await deploy('DemoUSD', A.usd, [me])
const registry = await deploy('MockRwaIdentityRegistry', A.reg, [me])
const property = await deploy(`MockPermissionedPropertyToken (${PROPERTY_SYMBOL})`, A.prop, [PROPERTY_NAME, PROPERTY_SYMBOL, 18, registry, me])
const adapter = await deploy('DemoLendingAdapter', A.lend, [usd, LEND_APR_BPS, me])
await call('DemoUSD.setMinter(adapter)', usd, A.usd, 'setMinter', [adapter, true])

// 2) the hook — CREATE2 through the deterministic factory with a mined salt
const hookArgs = encodeAbiParameters(
  [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, CONFIG_TUPLE],
  [POOL_MANAGER, me, me, me, CONFIG],
)
const hookInit = concat([A.hook.bytecode.object, hookArgs])
const initHash = keccak256(hookInit)
let salt, hookAddr
for (let i = 0n; i < 2_000_000n; i++) {
  const s = pad(toHex(i), { size: 32 })
  const addr = getContractAddress({ opcode: 'CREATE2', from: C2_FACTORY, salt: s, bytecodeHash: initHash })
  if ((BigInt(addr) & 0x3fffn) === HOOK_FLAGS) { salt = s; hookAddr = addr; break }
}
if (!salt) die('could not mine a hook salt')
console.log(`  · mined hook address ${hookAddr}`)
if (((await pub.getCode({ address: hookAddr })) ?? '0x').length <= 2 || progress.pending['deploy MintwareRwaAppraisalHook (CREATE2)']) {
  await sendOnce('deploy MintwareRwaAppraisalHook (CREATE2)', () => w.sendTransaction({ to: C2_FACTORY, data: concat([salt, hookInit]) }))
}
await retry(async () => { if (((await pub.getCode({ address: hookAddr })) ?? '0x').length <= 2) throw new Error('hook not at the mined address') }, 'hook code')

// 3) pool key (property / dUSD, dynamic fee)
const propIs0 = BigInt(property) < BigInt(usd)
const key = {
  currency0: propIs0 ? property : usd, currency1: propIs0 ? usd : property,
  fee: 0x800000, tickSpacing: 60, hooks: hookAddr,
}
const appraisal = propIs0 ? -TICK_ABS : TICK_ABS

// 4) the position library + the UNCHANGED treasury vault (library linked in)
const lib = await deploy('MWTreasuryPositionLib', A.lib)
let vaultCode = A.vault.bytecode.object
for (const refs of Object.values(A.vault.bytecode.linkReferences)) {
  for (const list of Object.values(refs)) {
    for (const { start, length } of list) {
      const at = 2 + start * 2
      vaultCode = vaultCode.slice(0, at) + lib.slice(2).toLowerCase() + vaultCode.slice(at + length * 2)
    }
  }
}
const vault = await deploy('MintwareTreasuryVault', A.vault, [POOL_MANAGER, key, usd, adapter, me, me], vaultCode)
const router = await deploy('DemoSwapRouter', A.router, [POOL_MANAGER])

// 5) wiring
await call('adapter.setVault', adapter, A.lend, 'setVault', [vault])
await call('vault.setProtocolTreasury', vault, A.vault, 'setProtocolTreasury', [me])
await call('vault.setJitHook(appraisal hook = oracle)', vault, A.vault, 'setJitHook', [hookAddr])
await call('vault.setMinCoverage(1%)', vault, A.vault, 'setMinCoverage', [100])
await call('hook.setVault', hookAddr, A.hook, 'setVault', [vault])
for (const [n, a] of [['PoolManager', POOL_MANAGER], ['vault', vault], ['router', router]]) {
  await call(`property.setPermittedHolder(${n})`, property, A.prop, 'setPermittedHolder', [a, true])
}

// 6) appraisal, then open the pool exactly at it
await call(`hook.initAppraisal(${appraisal})`, hookAddr, A.hook, 'initAppraisal', [appraisal])
await retry(async () => {
  const o = await pub.readContract({ address: hookAddr, abi: [{ type: 'function', name: 'oracleTick', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }, { type: 'bool' }] }], functionName: 'oracleTick' })
  if (Number(o[0]) !== appraisal || !o[1]) throw new Error('appraisal not live')
}, 'appraisal check')
// The hook's beforeInitialize re-derives the tick from this price and refuses anything outside the core band.
const sqrtPriceX96 = BigInt(process.env.INIT_SQRT_PRICE ?? sqrtAtTick(appraisal))
await call('PoolManager.initialize (at the appraisal)', POOL_MANAGER, A.pm, 'initialize', [key, sqrtPriceX96])

// 7) issuer commits the junior
await call('property.mint(junior inventory)', property, A.prop, 'mint', [me, JUNIOR_TOKENS])
await call('dUSD.mint(junior buffer)', usd, A.usd, 'mint', [me, JUNIOR_USD])
await call('property.approve(vault)', property, A.prop, 'approve', [vault, JUNIOR_TOKENS])
await call('dUSD.approve(vault)', usd, A.usd, 'approve', [vault, JUNIOR_USD])
await call('vault.commitTeam (junior, 1-year lock)', vault, A.vault, 'commitTeam', [JUNIOR_TOKENS, JUNIOR_USD, 365n * 86400n])

const deployment = {
  generatedAt: new Date().toISOString(), chainId, signer: me, signerKind: kind,
  contracts: { usd, registry, property, adapter, hook: hookAddr, positionLib: lib, vault, router, poolManager: POOL_MANAGER },
  property: { name: PROPERTY_NAME, symbol: PROPERTY_SYMBOL, decimals: 18, appraisalUsdAtLaunch: 100 },
  hookConfig: CONFIG, appraisalTick: appraisal, propertyIsCurrency0: propIs0,
  poolKey: key, hookSalt: salt, txs,
}
mkdirSync(dirname(DEPLOYMENT_OUT), { recursive: true })
writeFileSync(DEPLOYMENT_OUT, JSON.stringify(deployment, null, 2) + '\n')
console.log(`\n✓ deployed + opened — ${txs.length} txs → ${DEPLOYMENT_OUT}`)
console.log(`  gas left: ${formatEther(await pub.getBalance({ address: me }))} ETH`)

// ── TickMath.getSqrtPriceAtTick, ported verbatim (v4-core) ─────────────────
function sqrtAtTick(tick) {
  const absTick = BigInt(tick < 0 ? -tick : tick)
  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n
  const M = [
    [0x2n, 0xfff97272373d413259a46990580e213an], [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn], [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n], [0x20n, 0xff973b41fa98c081472e6896dfb254c0n], [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n], [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n], [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n], [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n], [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n], [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n], [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n], [0x20000n, 0x5d6af8dedb81196699c329225ee604n], [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ]
  for (const [bit, mul] of M) if ((absTick & bit) !== 0n) ratio = (ratio * mul) >> 128n
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

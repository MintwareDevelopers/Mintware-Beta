// V2-RWAs — run the full demo lifecycle against a DEPLOYED liquidity unit and record every proof hash.
//
// Prereq: scripts/deploy-rwa-demo.mjs (writes config/rwaDemo.deployment.json). Everything else is read back
// from the vault itself (usd / property / adapter / hook), so the proof file can never point at a mismatched set.
//
// The run, each step a real transaction whose hash lands in the proof file:
//   1. issuer verifies two traders in the identity registry
//   2. three open LPs supply dUSD to the senior tranche (they are NOT verified — they never hold the asset)
//   3. a slice of senior is deployed into the v4 pool next to the issuer's property inventory; the rest earns
//   4. verified traders buy and sell inside the appraisal band
//   5. an UNVERIFIED wallet tries to buy → the property token refuses it → the tx is mined REVERTED
//   6. a trade that would push price beyond the band → the hook refuses it → mined REVERTED
//   7. the keeper posts a new appraisal (bounded step, after the rate-limit interval)
//   8. the lending adapter realises its accrued interest
//   9. an LP exits — and receives dUSD only
//
// Steps 5 and 6 are sent with an explicit gas limit so they are MINED as failed transactions, then the script
// replays each against its parent block and REQUIRES the decoded revert to be the intended rule (NotPermitted
// from the token; PriceOutOfBand from the hook) — stored in the proof file as `reason`.
//
// TESTNET ONLY. Demo wallets are generated once and kept in RWA_DEMO_WALLETS (gitignored); they hold only
// valueless testnet tokens + a little testnet ETH for gas.
//
// Signed by the dedicated `rwa` Privy seat (scripts/lib/rwaSigner.mjs) — no raw key. Reads the unit from
// config/rwaDemo.deployment.json (written by scripts/deploy-rwa-demo.mjs).
// Run:
//   node --env-file=.env.robinhood.local scripts/rwa-demo-lifecycle.mjs
//   RWA_NETWORK=xrpl-evm-testnet node --env-file=.env.robinhood.local scripts/rwa-demo-lifecycle.mjs
// Env: RWA_NETWORK (preset in scripts/lib/rwaNetworks.mjs, default base-sepolia) — sets the RPC, the output files
//      (Base Sepolia: config/rwaDemo.json; XRPL EVM testnet: config/rwaDemo.xrpl.json), the wallets file and the
//      per-wallet gas fund. Each can be overridden: RWA_RPC_URL, RWA_DEMO_OUT, RWA_DEPLOYMENT_OUT,
//      RWA_DEMO_WALLETS, RWA_GAS_FUND_WEI.
//      RWA_REHEARSAL=1 + RWA_REHEARSAL_KEY (local anvil fork: throwaway key, fast-forward time instead of waiting).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, defineChain, parseAbi, decodeErrorResult } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { resolveRwaSigner } from './lib/rwaSigner.mjs'
import { resolveNetwork, assertTestnet, chainMeta } from './lib/rwaNetworks.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'contracts-v4', 'out')

const NET = (() => { try { return resolveNetwork(ROOT) } catch (e) { console.error(`\n✗ ${e.message}`); process.exit(1) } })()
const RPC = NET.rpc
const OUT_FILE = NET.demoFile
const DEPLOYMENT_FILE = NET.deploymentFile
const WALLETS_FILE = NET.walletsFile
const REHEARSAL = process.env.RWA_REHEARSAL === '1'
const GAS_FUND = NET.gasFundWei
const FORCED_GAS = 600_000n

function die(m) { console.error(`\n✗ ${m}`); process.exit(1) }
const log = (m) => console.log(`  ${m}`)

const deployment = existsSync(DEPLOYMENT_FILE) ? JSON.parse(readFileSync(DEPLOYMENT_FILE, 'utf8')) : null
const vaultAddr = process.env.RWA_VAULT ?? deployment?.contracts?.vault
if (!vaultAddr || !/^0x[0-9a-fA-F]{40}$/.test(vaultAddr)) die('no vault: run scripts/deploy-rwa-demo.mjs first (or set RWA_VAULT)')

const abi = (file, name = file) => JSON.parse(readFileSync(join(OUT, `${file}.sol`, `${name}.json`), 'utf8')).abi
const VAULT = abi('MintwareTreasuryVault')
const HOOK = abi('MintwareRwaAppraisalHook')
const PROP = abi('MockPermissionedPropertyToken')
const REG = abi('MockRwaIdentityRegistry')
const USD = abi('DemoUSD')
const LEND = abi('DemoLendingAdapter')
const ROUTER = abi('DemoSwapRouter')

const pub0 = createPublicClient({ transport: http(RPC) })
const chainId = await pub0.getChainId()
try { assertTestnet(NET, chainId) } catch (e) { die(e.message) }
if (deployment && deployment.chainId !== chainId) die(`${DEPLOYMENT_FILE} is for chain ${deployment.chainId}, RPC is chain ${chainId}`)
const chain = defineChain({ id: chainId, name: NET.name, nativeCurrency: NET.nativeCurrency, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const { account: issuer, kind: signerKind } = await resolveRwaSigner().catch((e) => die(e.message))
const wallet = (account) => createWalletClient({ account, chain, transport: http(RPC) })

// ── read the unit back from the vault ──────────────────────────────────────
const read = (address, a, functionName, args = []) => pub.readContract({ address, abi: a, functionName, args })
const usd = await read(vaultAddr, VAULT, 'usdc')
const property = await read(vaultAddr, VAULT, 'teamToken')
const adapter = await read(vaultAddr, VAULT, 'adapter')
const hook = await read(vaultAddr, VAULT, 'jitHook')
const poolKey = await read(vaultAddr, VAULT, 'poolKey')
const registry = await read(property, PROP, 'registry')
const routerAddr = process.env.RWA_ROUTER ?? deployment?.contracts?.router ?? die('no router: run scripts/deploy-rwa-demo.mjs first (or set RWA_ROUTER)')
const key = { currency0: poolKey[0], currency1: poolKey[1], fee: poolKey[2], tickSpacing: poolKey[3], hooks: poolKey[4] }
const propIs0 = key.currency0.toLowerCase() === property.toLowerCase()
const propName = await read(property, PROP, 'name')
const propSymbol = await read(property, PROP, 'symbol')

console.log(`\nV2-RWAs demo lifecycle — chain ${chainId}`)
log(`vault ${vaultAddr}  hook ${hook}  property ${propSymbol} ${property}`)

// ── demo wallets (persisted, gitignored) ───────────────────────────────────
const LABELS = { aliceLP: 'LP · Alice', benLP: 'LP · Ben', chloeLP: 'LP · Chloe', danaTrader: 'Verified trader · Dana', eliTrader: 'Verified trader · Eli', foxUnverified: 'Unverified wallet · Fox' }
let stored = existsSync(WALLETS_FILE) ? JSON.parse(readFileSync(WALLETS_FILE, 'utf8')) : {}
for (const k of Object.keys(LABELS)) if (!stored[k]) stored[k] = generatePrivateKey()
writeFileSync(WALLETS_FILE, JSON.stringify(stored, null, 2), { mode: 0o600 })
const W = Object.fromEntries(Object.entries(stored).filter(([k]) => LABELS[k]).map(([k, v]) => [k, privateKeyToAccount(v)]))

// ── tx helpers ─────────────────────────────────────────────────────────────
const legs = []
let leg = null
function startLeg(title, desc) { leg = { n: legs.length + 1, title, desc, txs: [] }; legs.push(leg); console.log(`\n${leg.n}. ${title}`) }

// Load-balanced RPCs can serve a read from a node one block behind the last receipt — retry simulations.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function simulateWithRetry(opts, label, tries = 6) {
  for (let i = 1; ; i++) {
    try { return await pub.simulateContract(opts) } catch (e) {
      if (i >= tries) die(`${label}: simulation failed — ${e.shortMessage ?? e.message}`)
      await sleep(2500)
    }
  }
}

// Resumable: every confirmed step is checkpointed by label, so a re-run replays recorded hashes instead of
// re-sending (no double deposits / double mints). Delete the progress file to start a fresh story.
const PROGRESS = `${OUT_FILE}.progress.json`
const progress = existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, 'utf8')) : { vault: vaultAddr, steps: {} }
if (progress.vault?.toLowerCase() !== vaultAddr.toLowerCase()) die(`progress file ${PROGRESS} belongs to another vault — move it aside`)
const checkpoint = () => writeFileSync(PROGRESS, JSON.stringify(progress, null, 2))

// Decode WHY a mined tx reverted, from the chain itself: replay its exact calldata against the parent block and
// unwrap v4's WrappedError(target, selector, reason, details) down to the rule that fired.
const RULE_ERRORS = parseAbi([
  'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)',
  'error NotPermitted(address account)',
  'error PriceOutOfBand(int24 tick, int24 appraisal)',
  'error AppraisalStale()',
  'error TradingIsPaused()',
])
async function revertReason(hash) {
  const tx = await pub.getTransaction({ hash })
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{ from: tx.from, to: tx.to, data: tx.input, gas: `0x${tx.gas.toString(16)}` }, `0x${(tx.blockNumber - 1n).toString(16)}`],
  }) }).then((r) => r.json())
  let data = res.error?.data, target = null
  for (let depth = 0; data && depth < 4; depth++) {
    let d
    try { d = decodeErrorResult({ abi: RULE_ERRORS, data }) } catch { return { error: `unknown ${String(data).slice(0, 10)}`, target, args: [] } }
    if (d.errorName !== 'WrappedError') return { error: d.errorName, target, args: d.args.map(String) }
    target = d.args[0]; data = d.args[2]
  }
  return { error: 'none', target, args: [] }
}

// Resumable + send-once: a step's hash is checkpointed the moment it is BROADCAST, so a crash or a receipt
// timeout resumes by waiting on that hash — never by sending the step a second time.
async function send(account, address, a, functionName, args, label, { expectRevert = null } = {}) {
  const done = progress.steps[label]
  if (done) {
    log(`· ${label} (already on-chain ${done.hash})`)
    if (leg) leg.txs.push(done)
    return done
  }
  progress.pending ??= {}
  let hash = progress.pending[label]
  let gas = FORCED_GAS
  if (hash) log(`· ${label}: resuming, waiting on ${hash}`)
  else {
    const w = wallet(account)
    const opts = { address, abi: a, functionName, args, account }
    if (!expectRevert) {
      await simulateWithRetry(opts, label)
      // Explicit headroom: an estimate served by a lagging node can miss state-dependent work (e.g. the
      // lending adapter minting freshly accrued interest) and run the real tx out of gas.
      const est = await pub.estimateContractGas(opts).catch(() => 300_000n)
      gas = (est * 16n) / 10n + 30_000n
    } else {
      await sleep(3000) // let the prior state settle on every backend before the deliberate revert
    }
    hash = await w.writeContract({ ...opts, gas })
    progress.pending[label] = hash
    checkpoint()
  }
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 })
  const status = r.status === 'success' ? 'success' : 'reverted'
  const rec = { label, hash, status, from: account.address, block: Number(r.blockNumber) }
  if (expectRevert) {
    if (status !== 'reverted') { recordFailure(rec); die(`${label}: expected an on-chain revert, got ${status}`) }
    await sleep(2500)
    const why = await revertReason(hash)
    rec.reason = why
    // The proof only counts if the chain says the INTENDED rule fired (not out-of-gas, not some other check).
    if (why.error !== expectRevert.error || (expectRevert.target && why.target?.toLowerCase() !== expectRevert.target.toLowerCase())) {
      recordFailure(rec); die(`${label}: reverted for ${why.error} in ${why.target}, expected ${expectRevert.error} (${hash})`)
    }
  } else if (status !== 'success') { recordFailure(rec); die(`${label}: reverted (${hash}, gas ${r.gasUsed})`) }
  log(`${status === 'success' ? '✓' : `⨯ reverted (expected: ${rec.reason.error})`}  ${label}  ${hash}`)
  delete progress.pending[label]
  progress.steps[label] = rec
  checkpoint()
  if (leg) leg.txs.push(rec)
  return rec
}
function recordFailure(rec) {
  progress.failures ??= []
  progress.failures.push(rec)
  delete progress.pending[rec.label]
  checkpoint()
}

async function fundGas(to) {
  const bal = await pub.getBalance({ address: to })
  if (bal >= GAS_FUND / 2n) return
  const hash = await wallet(issuer).sendTransaction({ to, value: GAS_FUND })
  await pub.waitForTransactionReceipt({ hash })
}

async function advance(seconds) {
  if (REHEARSAL) {
    await pub.request({ method: 'evm_increaseTime', params: [seconds] })
    await pub.request({ method: 'evm_mine', params: [] })
  } else {
    log(`waiting ${seconds}s (appraisal rate limit)…`)
    await new Promise((r) => setTimeout(r, seconds * 1000))
  }
}

const D6 = (n) => parseUnits(String(n), 6)
const D18 = (n) => parseUnits(String(n), 18)
const MAXU = 2n ** 256n - 1n

// ── setup (not proof legs) ─────────────────────────────────────────────────
console.log('\nsetup: gas + demo dUSD for the demo wallets')
for (const a of Object.values(W)) await fundGas(a.address)
const lpAmounts = { aliceLP: 60_000, benLP: 30_000, chloeLP: 25_000 }
for (const [k, amt] of Object.entries(lpAmounts)) await send(issuer, usd, USD, 'mint', [W[k].address, D6(amt)], `mint ${amt} dUSD → ${LABELS[k]}`)
for (const k of ['danaTrader', 'eliTrader', 'foxUnverified']) await send(issuer, usd, USD, 'mint', [W[k].address, D6(5_000)], `mint 5,000 dUSD → ${LABELS[k]}`)
for (const k of ['danaTrader', 'eliTrader', 'foxUnverified']) await send(W[k], usd, USD, 'approve', [routerAddr, MAXU], `${LABELS[k]} approves the router`)
for (const k of Object.keys(lpAmounts)) await send(W[k], usd, USD, 'approve', [vaultAddr, MAXU], `${LABELS[k]} approves the vault`)
legs.length = 0

// ── 1. verification ────────────────────────────────────────────────────────
startLeg('Issuer verifies two traders', 'The identity registry marks Dana and Eli as verified holders. Fox is never verified. LPs are never verified either — they never hold the asset.')
const farFuture = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400)
await send(issuer, registry, REG, 'setVerified', [W.danaTrader.address, farFuture], 'Verify Dana')
await send(issuer, registry, REG, 'setVerified', [W.eliTrader.address, farFuture], 'Verify Eli')

// ── 2. senior deposits ─────────────────────────────────────────────────────
startLeg('Open LPs supply dUSD', 'Three unverified wallets supply dUSD to the senior tranche. Senior is paid first, in dUSD.')
for (const [k, amt] of Object.entries(lpAmounts)) await send(W[k], vaultAddr, VAULT, 'depositUSDC', [D6(amt), 0n, W[k].address], `${LABELS[k]} deposits ${amt.toLocaleString()} dUSD`)

// ── 3. deploy to the pool ──────────────────────────────────────────────────
startLeg('A slice goes to the pool; the rest keeps earning', 'The vault pairs ~19% of senior with the issuer’s property inventory in the Uniswap v4 pool. The other ~81% stays in the lending venue.')
await send(issuer, vaultAddr, VAULT, 'deployToLP', [D6(22_000), D18(1_000)], 'Deploy 22,000 dUSD of senior into the pool')

// ── 4. verified trading ────────────────────────────────────────────────────
const buy = (who, usdIn, label, o) => send(W[who], routerAddr, ROUTER, 'swapExactIn', [key, !propIs0, D6(usdIn), 0n], label, o)
const sell = (who, units, label, o) => send(W[who], routerAddr, ROUTER, 'swapExactIn', [key, propIs0, D18(units), 0n], label, o)
startLeg('Verified traders trade inside the band', 'Dana and Eli buy and sell the property token. Every trade settles inside the appraisal band.')
await buy('danaTrader', 250, 'Dana buys with 250 dUSD')
await buy('eliTrader', 150, 'Eli buys with 150 dUSD')
await send(W.danaTrader, property, PROP, 'approve', [routerAddr, MAXU], 'Dana approves the router (property)')
await sell('danaTrader', 1, `Dana sells 1 ${propSymbol}`)

// ── 5. unverified refused ──────────────────────────────────────────────────
startLeg('An unverified wallet is refused', 'Fox tries to buy. The property token itself refuses to deliver to an unverified wallet, so the whole swap reverts on-chain.')
await buy('foxUnverified', 100, 'Fox (unverified) tries to buy with 100 dUSD', { expectRevert: { error: 'NotPermitted', target: property } })

// ── 6. out of band refused ─────────────────────────────────────────────────
startLeg('A trade beyond the band is refused', 'A buy large enough to push the price more than ~10% past the appraisal is rejected by the hook.')
await buy('danaTrader', 2_500, 'Dana tries a 2,500 dUSD buy (would leave the band)', { expectRevert: { error: 'PriceOutOfBand', target: hook } })

// ── 7. appraisal update ────────────────────────────────────────────────────
startLeg('The appraisal moves, within its limits', 'The keeper posts a new appraisal: bounded to ~5% per update and at most once per interval. The band moves with it.')
const cfg = await read(hook, HOOK, 'config')
const appraisedAt = Number(await read(hook, HOOK, 'appraisedAt'))
const block = await pub.getBlock()
const waitS = Math.max(0, appraisedAt + Number(cfg[3]) - Number(block.timestamp) + 5)
if (waitS > 0) await advance(waitS)
const prevTick = Number(await read(hook, HOOK, 'appraisalTick'))
const step = propIs0 ? 200 : -200 // +2% property value, in pool-tick orientation
await send(issuer, hook, HOOK, 'postAppraisal', [prevTick + step], 'Keeper posts appraisal +2%')

// ── 8. lending yield ───────────────────────────────────────────────────────
startLeg('Idle liquidity earns', 'The lending venue realises the interest accrued on the idle senior (simulated testnet yield).')
if (REHEARSAL) await advance(7 * 86400)
await send(issuer, adapter, LEND, 'accrue', [], 'Realise accrued lending interest')

// ── 9. LP exit ─────────────────────────────────────────────────────────────
startLeg('An LP exits in dUSD only', 'Chloe redeems half her senior shares and receives dUSD. She never held, and is not eligible to hold, the property token.')
let chloeShares = 0n
for (let i = 0; i < 6 && chloeShares === 0n; i++) {
  chloeShares = await read(vaultAddr, VAULT, 'seniorShares', [W.chloeLP.address])
  if (chloeShares === 0n) await sleep(2500)
}
if (chloeShares === 0n) die('Chloe has no senior shares to redeem')
await send(W.chloeLP, vaultAddr, VAULT, 'redeemSenior', [chloeShares / 2n, 0n], 'Chloe redeems half her senior')

// ── snapshot + write ───────────────────────────────────────────────────────
await sleep(8000) // let every RPC backend catch up to the last receipt before the snapshot read
const snap = {
  seniorAssets: formatUnits(await read(vaultAddr, VAULT, 'totalSeniorAssets'), 6),
  deployedFromSenior: formatUnits(await read(vaultAddr, VAULT, 'deployedFromSenior'), 6),
  lendingBalance: formatUnits(await read(adapter, LEND, 'totalAssets'), 6),
  interestMinted: formatUnits(await read(adapter, LEND, 'totalInterestMinted'), 6),
  chloePropertyBalance: formatUnits(await read(property, PROP, 'balanceOf', [W.chloeLP.address]), 18),
  foxPropertyBalance: formatUnits(await read(property, PROP, 'balanceOf', [W.foxUnverified.address]), 18),
}
const out = {
  generatedAt: new Date().toISOString(),
  chainId,
  chain: chainMeta(NET),
  rehearsal: REHEARSAL,
  poolManagerDeployedByUs: deployment?.poolManagerDeployedByUs ?? false,
  property: { name: propName, symbol: propSymbol, appraisalUsdAtLaunch: 100, decimals: 18 },
  contracts: { vault: vaultAddr, hook, property, usd, adapter, registry, router: routerAddr, poolManager: await read(vaultAddr, VAULT, 'poolManager') },
  poolKey: { ...key, fee: Number(key.fee), tickSpacing: Number(key.tickSpacing) },
  propertyIsCurrency0: propIs0,
  wallets: Object.fromEntries(Object.entries(W).map(([k, a]) => [k, { label: LABELS[k], address: a.address }])),
  issuer: issuer.address,
  signerKind,
  hookConfig: deployment?.hookConfig ?? null,
  deployTxs: deployment?.txs ?? [],
  snapshot: snap,
  legs,
}
mkdirSync(dirname(OUT_FILE), { recursive: true })
writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n')
console.log(`\n✓ ${legs.reduce((n, l) => n + l.txs.length, 0)} proof transactions across ${legs.length} legs → ${OUT_FILE}`)
console.log(snap)

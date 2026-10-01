// V2-RWAs — run the full demo lifecycle against a DEPLOYED liquidity unit and record every proof hash.
//
// Prereq: `forge script contracts-v4/script/DeployRwaLiquidityUnit.s.sol --rpc-url <rpc> --broadcast` (that
// script prints the vault address; pass it as RWA_VAULT). Everything else is read back from the vault itself
// (usd / property / adapter / hook), so the proof file can never point at a mismatched contract set.
//
// The run, each step a real transaction whose hash lands in the proof file:
//   1. issuer verifies two traders in the identity registry
//   2. three open LPs deposit dUSD as the senior tranche (they are NOT verified — they never hold the asset)
//   3. a slice of senior is deployed into the v4 pool next to the issuer's property inventory; the rest earns
//   4. verified traders buy and sell inside the appraisal band
//   5. an UNVERIFIED wallet tries to buy → the property token refuses it → the tx is mined REVERTED
//   6. a trade that would push price beyond the band → the hook refuses it → mined REVERTED
//   7. the keeper posts a new appraisal (bounded step, after the rate-limit interval)
//   8. the lending adapter realises its accrued interest
//   9. an LP exits — and receives dUSD only
//
// Steps 5 and 6 are sent with an explicit gas limit so they are MINED as failed transactions — on-chain
// evidence of the compliance gate and the band, not a simulation.
//
// TESTNET ONLY. Demo wallets are generated once and kept in RWA_DEMO_WALLETS (gitignored); they hold only
// valueless testnet tokens + a little testnet ETH for gas.
//
// Signed by the dedicated `rwa` Privy seat (scripts/lib/rwaSigner.mjs) — no raw key. Reads the unit from
// config/rwaDemo.deployment.json (written by scripts/deploy-rwa-demo.mjs).
// Run:
//   node --env-file=.env.robinhood.local scripts/rwa-demo-lifecycle.mjs
// Env: RWA_RPC_URL (https://sepolia.base.org), RWA_DEMO_OUT (config/rwaDemo.json),
//      RWA_DEMO_WALLETS (.rwa-demo-wallets.json), RWA_GAS_FUND_WEI (per demo wallet, default 0.00012 ETH),
//      RWA_REHEARSAL=1 + RWA_REHEARSAL_KEY (local anvil fork: throwaway key, fast-forward time instead of waiting).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, defineChain } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { resolveRwaSigner } from './lib/rwaSigner.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'contracts-v4', 'out')

const RPC = process.env.RWA_RPC_URL ?? 'https://sepolia.base.org'
const OUT_FILE = process.env.RWA_DEMO_OUT ?? join(ROOT, 'config', 'rwaDemo.json')
const DEPLOYMENT_FILE = process.env.RWA_DEPLOYMENT_OUT ?? join(ROOT, 'config', 'rwaDemo.deployment.json')
const WALLETS_FILE = process.env.RWA_DEMO_WALLETS ?? join(ROOT, '.rwa-demo-wallets.json')
const REHEARSAL = process.env.RWA_REHEARSAL === '1'
const GAS_FUND = BigInt(process.env.RWA_GAS_FUND_WEI ?? '120000000000000') // 0.00012 ETH per demo wallet
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
const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
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

async function send(account, address, a, functionName, args, label, { expectRevert = false } = {}) {
  const w = wallet(account)
  const opts = { address, abi: a, functionName, args, account }
  const hash = expectRevert
    ? await w.writeContract({ ...opts, gas: FORCED_GAS })
    : await w.writeContract({ ...opts, ...(await pub.simulateContract(opts).then(() => ({})).catch((e) => die(`${label}: simulation failed — ${e.shortMessage ?? e.message}`))) })
  const r = await pub.waitForTransactionReceipt({ hash })
  const status = r.status === 'success' ? 'success' : 'reverted'
  if (expectRevert && status !== 'reverted') die(`${label}: expected an on-chain revert, got ${status}`)
  if (!expectRevert && status !== 'success') die(`${label}: reverted (${hash})`)
  log(`${status === 'success' ? '✓' : '⨯ reverted (expected)'}  ${label}  ${hash}`)
  if (leg) leg.txs.push({ label, hash, status, from: account.address, block: Number(r.blockNumber) })
  return r
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
startLeg('Open LPs supply dUSD', 'Three unverified wallets deposit into the senior tranche. Senior is paid first, at par, in dUSD.')
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
await buy('foxUnverified', 100, 'Fox (unverified) tries to buy with 100 dUSD', { expectRevert: true })

// ── 6. out of band refused ─────────────────────────────────────────────────
startLeg('A trade beyond the band is refused', 'A buy large enough to push the price more than ~10% past the appraisal is rejected by the hook.')
await buy('danaTrader', 2_500, 'Dana tries a 2,500 dUSD buy (would leave the band)', { expectRevert: true })

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
const chloeShares = await read(vaultAddr, VAULT, 'seniorShares', [W.chloeLP.address])
await send(W.chloeLP, vaultAddr, VAULT, 'redeemSenior', [chloeShares / 2n, 0n], 'Chloe redeems half her senior')

// ── snapshot + write ───────────────────────────────────────────────────────
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
  rehearsal: REHEARSAL,
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

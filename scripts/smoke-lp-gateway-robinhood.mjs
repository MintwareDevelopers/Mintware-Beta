// Smoke test the live LP Gateway rig on Robinhood testnet (46630) — pure-Privy, no raw key (mirrors the
// deploy script's signer setup). Proves the fresh 2026-09-07b rig works end-to-end AND that the redeploy's
// new functions (setPaused item 13, compoundQuote item 14) — which the prior rig 0x39B8…BD2a predated —
// are actually on-chain and behave:
//   1. deposit 1,000 tUSDG → 1:1 shares, totalNav ≈ deposit           (stage-and-earn)
//   2. compoundQuote(5)    → NAV +5, ZERO share mint                  (item 14)
//   3. setPaused(true)     → paused, a new deposit REVERTS; unpause   (item 13)
//   4. withdraw(50%)       → value back out                          (round-trip, never locked)
//
// Run:  node --env-file=.env.robinhood.local scripts/smoke-lp-gateway-robinhood.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPublicClient, createWalletClient, http, formatEther } from 'viem'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'contracts-v4', 'out')

const CHAIN_ID = Number(process.env.LP_GATEWAY_CHAIN_ID ?? 46630)
const RPC = process.env.LP_GATEWAY_RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com'
// The 2026-09-08 rig (g) — round-3 exploit-replay fixes on top of the close-out rig; env-overridable.
// NB: Robinhood's block.number is the L1 block (~12 s) — several txs land in one block, so a deposit followed too
// quickly by a withdraw trips SameBlockAction (by design); re-run if that happens.
// tUSDG was minted 1M to the Privy signer at deploy.
const PM = (process.env.LP_GATEWAY_POSITION_MANAGER ?? '0xa52d4ffaefa586251cb36d1e05588daa89ab0a63').toLowerCase()
const TUSDG = (process.env.LP_GATEWAY_TUSDG ?? '0x2a8c32e291bc90ceb8ae058b6a684be0312bb848').toLowerCase()

const DEPOSIT = 1000n * 10n ** 6n // 1,000 tUSDG (6dp)
const COMPOUND = 5n * 10n ** 6n // 5 tUSDG compounded (no share mint)

function die(m) { console.error(`\n✗ ${m}`); process.exit(1) }
function ok(m) { console.log(`  ✓ ${m}`) }
const u6 = (x) => (Number(x) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })

function abiOf(name, file = name) {
  const j = JSON.parse(readFileSync(join(OUT, `${file}.sol`, `${name}.json`), 'utf8'))
  return j.abi
}
const PM_ABI = abiOf('MintwareLpGatewayPositionManager')
const ERC20 = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
]

// ── Privy signer (no raw key) ──
if ((process.env.ORACLE_SIGNER_PROVIDER ?? '').toLowerCase() !== 'privy') die('set ORACLE_SIGNER_PROVIDER=privy')
const { PRIVY_APP_ID, PRIVY_APP_SECRET, ROOT_ORACLE_PRIVY_WALLET_ID: walletId, ROOT_ORACLE_PRIVY_ADDRESS: signer } = process.env
if (!PRIVY_APP_ID || !PRIVY_APP_SECRET || !walletId || !signer) die('missing Privy env (APP_ID/SECRET/WALLET_ID/ADDRESS)')
const { PrivyClient } = await import('@privy-io/server-auth')
const { createViemAccount } = await import('@privy-io/server-auth/viem')
// O-6: pass the seat's wallet-API authorization key when the dashboard has one enabled for this wallet.
const authKey = process.env.GATEWAY_ORACLE_PRIVY_AUTH_KEY ?? process.env.ROOT_ORACLE_PRIVY_AUTH_KEY ?? ''
const privy = authKey
  ? new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET, { walletApi: { authorizationPrivateKey: authKey } })
  : new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
const account = await createViemAccount({ walletId, address: signer, privy })

const chain = { id: CHAIN_ID, name: `robinhood-${CHAIN_ID}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }
const pub = createPublicClient({ chain, transport: http(RPC) })
const wallet = createWalletClient({ account, chain, transport: http(RPC) })

if ((await pub.getChainId()) !== CHAIN_ID) die('RPC chain-id mismatch')
for (const [l, a] of [['PositionManager', PM], ['tUSDG', TUSDG]]) {
  if (!(await pub.getBytecode({ address: a }))) die(`${l} ${a} has no code on chain ${CHAIN_ID}`)
}
const gas = await pub.getBalance({ address: signer })
console.log(`\nSigner ${signer} · gas ${formatEther(gas)} · PM ${PM}`)
if (gas === 0n) die('signer has 0 gas — fund it at https://faucet.testnet.chain.robinhood.com/')

const read = (functionName, args = []) => pub.readContract({ address: PM, abi: PM_ABI, functionName, args })
async function tx(label, params, addr = PM, abi = PM_ABI) {
  const hash = await wallet.writeContract({ account, chain, address: addr, abi, ...params })
  const rc = await pub.waitForTransactionReceipt({ hash })
  if (rc.status !== 'success') die(`${label} reverted (${hash})`)
  ok(`${label}  ${hash.slice(0, 10)}…`)
  return hash
}

console.log('\n① Deposit 1,000 tUSDG (stage-and-earn)')
const bal = await pub.readContract({ address: TUSDG, abi: ERC20, functionName: 'balanceOf', args: [signer] })
if (bal < DEPOSIT) die(`signer tUSDG balance ${u6(bal)} < 1,000 — wrong token or unminted rig`)
const navBefore = await read('totalNav')
const sharesBefore = await read('totalShares')
await tx('approve tUSDG', { functionName: 'approve', args: [PM, DEPOSIT] }, TUSDG, ERC20)
await tx('deposit(1000e6)', { functionName: 'deposit', args: [DEPOSIT] })
const myShares = await read('sharesOf', [signer])
const navAfter = await read('totalNav')
console.log(`    totalNav ${u6(navBefore)} → ${u6(navAfter)} · my shares ${u6(myShares)}`)
if (navAfter - navBefore < DEPOSIT - 2n) die('totalNav did not rise by ~deposit')
ok('deposit staged, ~1:1 shares')

console.log('\n② compoundQuote(5) — lifts NAV, mints NO shares (Krystal item 14)')
const tsBefore = await read('totalShares')
const navB2 = await read('totalNav')
await tx('approve tUSDG (compound)', { functionName: 'approve', args: [PM, COMPOUND] }, TUSDG, ERC20)
await tx('compoundQuote(5e6)', { functionName: 'compoundQuote', args: [COMPOUND] })
const tsAfter = await read('totalShares')
const navC = await read('totalNav')
console.log(`    totalShares ${u6(tsBefore)} → ${u6(tsAfter)} (unchanged) · totalNav ${u6(navB2)} → ${u6(navC)} (+${u6(navC - navB2)})`)
if (tsAfter !== tsBefore) die('compoundQuote minted shares — should not')
if (navC - navB2 < COMPOUND - 2n) die('compoundQuote did not lift NAV')
ok('compoundQuote on-chain: NAV up, no dilution')

console.log('\n③ setPaused(true) blocks deposits, never withdraw (Krystal item 13)')
await tx('setPaused(true)', { functionName: 'setPaused', args: [true] })
if ((await read('paused')) !== true) die('paused flag not set')
let reverted = false
try {
  await tx('approve (paused)', { functionName: 'approve', args: [PM, COMPOUND] }, TUSDG, ERC20)
  await tx('deposit while paused (EXPECT revert)', { functionName: 'deposit', args: [COMPOUND] })
} catch { reverted = true }
if (!reverted) die('deposit succeeded while paused — breaker not working')
ok('deposit correctly reverts while paused')
await tx('setPaused(false)', { functionName: 'setPaused', args: [false] })
if ((await read('paused')) !== false) die('unpause failed')
ok('unpaused — deposits restored')

console.log('\n④ withdraw 50% (never locked — round-trip)')
const half = (await read('sharesOf', [signer])) / 2n
const q0 = await pub.readContract({ address: TUSDG, abi: ERC20, functionName: 'balanceOf', args: [signer] })
await tx(`withdraw(${u6(half)} shares)`, { functionName: 'withdraw', args: [half] })
const q1 = await pub.readContract({ address: TUSDG, abi: ERC20, functionName: 'balanceOf', args: [signer] })
console.log(`    tUSDG returned to signer: ${u6(q1 - q0)}`)
if (q1 <= q0) die('withdraw returned no value')
ok('withdraw returned value — position never locked')

console.log(`\n✓ SMOKE PASSED — rig ${PM.slice(0, 6)}…${PM.slice(-4)} live: deposit · compound · pause · withdraw all on-chain.\n`)

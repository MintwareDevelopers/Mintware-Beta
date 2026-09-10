// End-to-end app-level wallet-flow verification for LP Gateway V1 (user directive, 2026-09-10: "for 3
// use privy its funded testnet" — item 3's remaining piece: deposit/withdraw checked through the REAL
// application, not just the raw contract calls scripts/smoke-lp-gateway-robinhood.mjs already proves).
//
// Unlike the smoke test, this script exercises the ACTUAL user-facing path: a real on-chain deposit/
// withdraw tx, signed EIP-191 recording message (the exact shape createHandler's auth:'signed-message'
// expects, mirroring lib/web3/signedActionMessages.ts#buildGatewayDepositMessage/WithdrawMessage — this
// script is plain JS with no TS path aliases, so the message shape is reproduced inline rather than
// imported), POSTed to the live /api/gateway/{deposit,withdraw} routes, then reads back
// /api/gateway/position to confirm the app's own cost-basis bookkeeping reflects it correctly — not just
// that the on-chain call succeeded.
//
// Directly motivated by a live incident this session found: migrations 20260909000004-000007 (new
// record_gateway_deposit_event/record_gateway_withdraw_event signatures) were applied to production
// BEFORE the matching app code was deployed, so every deposit/withdraw in that window silently recorded
// an ORPHANED (position_manager IS NULL) row — real funds were always safe (chain-first), but displayed
// cost basis was wrong. This script's whole point is proving the NOW-DEPLOYED code (c2313ffe, pushed and
// live) resolves position_manager correctly end-to-end, not just that migrations exist.
//
// Uses the SAME pure-Privy signer as the smoke test (no raw key) — this session's established pattern.
// Run:  node --env-file=.env.robinhood.local scripts/e2e-lp-gateway-deposit-withdraw.mjs [apiBaseUrl]
// Default apiBaseUrl: https://mintware.finance

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPublicClient, createWalletClient, http, formatEther } from 'viem'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'contracts-v4', 'out')

const CHAIN_ID = Number(process.env.LP_GATEWAY_CHAIN_ID ?? 46630)
const RPC = process.env.LP_GATEWAY_RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com'
const PM = (process.env.LP_GATEWAY_POSITION_MANAGER ?? '0xa52d4ffaefa586251cb36d1e05588daa89ab0a63').toLowerCase()
const TUSDG = (process.env.LP_GATEWAY_TUSDG ?? '0x2a8c32e291bc90ceb8ae058b6a684be0312bb848').toLowerCase()
// Rig 'g''s registered v4 poolId (config/deployments.json, robinhood-testnet) — the identity /api/gateway/
// {deposit,withdraw,position} resolve the instance by.
const POOL = (process.env.LP_GATEWAY_POOL_ID ?? '0x07340da7f228f72fd2a624571c34b0f217b5f3a8e2b2826373f4afffe0a0dfa2').toLowerCase()
const API_BASE = (process.argv[2] ?? 'https://mintware.finance').replace(/\/$/, '')

const DEPOSIT = 10n * 10n ** 6n // a small, real 10 tUSDG — this is an app-flow check, not a size test

function die(m) { console.error(`\n✗ ${m}`); process.exit(1) }
function ok(m) { console.log(`  ✓ ${m}`) }
const u6 = (x) => (Number(x) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 4 })

function abiOf(name, file = name) {
  const j = JSON.parse(readFileSync(join(OUT, `${file}.sol`, `${name}.json`), 'utf8'))
  return j.abi
}
const PM_ABI = abiOf('MintwareLpGatewayPositionManager')
const ERC20 = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
]

// ── Privy signer (no raw key) — same setup as scripts/smoke-lp-gateway-robinhood.mjs ──
if ((process.env.ORACLE_SIGNER_PROVIDER ?? '').toLowerCase() !== 'privy') die('set ORACLE_SIGNER_PROVIDER=privy')
const { PRIVY_APP_ID, PRIVY_APP_SECRET, ROOT_ORACLE_PRIVY_WALLET_ID: walletId, ROOT_ORACLE_PRIVY_ADDRESS: signer } = process.env
if (!PRIVY_APP_ID || !PRIVY_APP_SECRET || !walletId || !signer) die('missing Privy env (APP_ID/SECRET/WALLET_ID/ADDRESS)')
const { PrivyClient } = await import('@privy-io/server-auth')
const { createViemAccount } = await import('@privy-io/server-auth/viem')
const authKey = process.env.GATEWAY_ORACLE_PRIVY_AUTH_KEY ?? process.env.ROOT_ORACLE_PRIVY_AUTH_KEY ?? ''
const privy = authKey
  ? new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET, { walletApi: { authorizationPrivateKey: authKey } })
  : new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
const account = await createViemAccount({ walletId, address: signer, privy })
const addressLower = signer.toLowerCase()

const chain = { id: CHAIN_ID, name: `robinhood-${CHAIN_ID}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }
const pub = createPublicClient({ chain, transport: http(RPC) })
const wallet = createWalletClient({ account, chain, transport: http(RPC) })

if ((await pub.getChainId()) !== CHAIN_ID) die('RPC chain-id mismatch')
const gas = await pub.getBalance({ address: signer })
console.log(`\nSigner ${signer} · gas ${formatEther(gas)} · PM ${PM} · API ${API_BASE}`)
if (gas === 0n) die('signer has 0 gas — fund it at https://faucet.testnet.chain.robinhood.com/')

async function tx(label, params, addr = PM, abi = PM_ABI) {
  const hash = await wallet.writeContract({ account, chain, address: addr, abi, ...params })
  const rc = await pub.waitForTransactionReceipt({ hash })
  if (rc.status !== 'success') die(`${label} reverted (${hash})`)
  ok(`${label}  ${hash.slice(0, 10)}…`)
  return hash
}

// Mirrors lib/web3/signedActionMessages.ts#buildGatewayDepositMessage/buildGatewayWithdrawMessage
// exactly (same key order, same JSON.stringify(..., null, 2) formatting) — the route strict-compares
// the parsed signed payload to this shape, so any drift here would fail auth, not just look different.
function buildRecordMessage(action, txHash, pool, issuedAt) {
  return JSON.stringify({ action, address: addressLower, txHash: txHash.toLowerCase(), pool: pool ? pool.toLowerCase() : null, issuedAt }, null, 2)
}

async function postRecord(path, action, txHash) {
  const issuedAt = Date.now()
  const authMessage = buildRecordMessage(action, txHash, POOL, issuedAt)
  const authSignature = await account.signMessage({ message: authMessage })
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txHash, pool: POOL, authMessage, authSignature, issuedAt, address: addressLower }),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function getPosition() {
  const url = `${API_BASE}/api/gateway/position?address=${addressLower}&pool=${POOL}&pm=${PM}`
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

console.log('\n① Real on-chain deposit (10 tUSDG)')
const bal = await pub.readContract({ address: TUSDG, abi: ERC20, functionName: 'balanceOf', args: [signer] })
if (bal < DEPOSIT) die(`signer tUSDG balance ${u6(bal)} < 10 — fund the signer or check the token address`)
await tx('approve tUSDG', { functionName: 'approve', args: [PM, DEPOSIT] }, TUSDG, ERC20)
const depositTx = await tx('deposit(10e6)', { functionName: 'deposit', args: [DEPOSIT] })

console.log('\n② Record the deposit through the REAL app API (signed EIP-191, action-bound)')
const depRecord = await postRecord('/api/gateway/deposit', 'mintware-gateway-deposit', depositTx)
console.log(`    POST /api/gateway/deposit → ${depRecord.status}`, JSON.stringify(depRecord.json))
if (depRecord.status !== 200 || !depRecord.json.success) die(`deposit record failed: ${JSON.stringify(depRecord.json)}`)
ok(`app recorded the deposit — costBasisAtomic=${depRecord.json.costBasisAtomic}`)

console.log('\n③ Read back /api/gateway/position — this is the actual check: does cost basis reflect the deposit?')
const posAfterDeposit = await getPosition()
console.log(`    GET /api/gateway/position → ${posAfterDeposit.status}`, JSON.stringify(posAfterDeposit.json))
if (posAfterDeposit.status !== 200) die(`position read failed: ${JSON.stringify(posAfterDeposit.json)}`)
const p1 = posAfterDeposit.json.position ?? posAfterDeposit.json
if (p1?.costBasisComplete === false) die('position reports costBasisComplete:false right after a fresh deposit — the exact orphaned-row bug this script exists to catch')
const basisAfterDeposit = BigInt(String(p1?.costBasisAtomic ?? p1?.entryNav ?? '0'))
if (basisAfterDeposit < DEPOSIT - 2n) die(`cost basis ${basisAfterDeposit} does not reflect the ${DEPOSIT} deposit — orphaned-row bug reproduced`)
ok(`cost basis correctly shows the deposit: ${u6(basisAfterDeposit)} tUSDG`)

console.log('\n④ Real on-chain withdraw (half the position)')
const shares = await pub.readContract({ address: PM, abi: PM_ABI, functionName: 'sharesOf', args: [signer] })
const half = shares / 2n
if (half <= 0n) die('no shares to withdraw')
const withdrawTx = await tx(`withdraw(${u6(half)} shares)`, { functionName: 'withdraw', args: [half] })

console.log('\n⑤ Record the withdraw through the REAL app API')
const wdRecord = await postRecord('/api/gateway/withdraw', 'mintware-gateway-withdraw', withdrawTx)
console.log(`    POST /api/gateway/withdraw → ${wdRecord.status}`, JSON.stringify(wdRecord.json))
if (wdRecord.status !== 200 || !wdRecord.json.success) die(`withdraw record failed: ${JSON.stringify(wdRecord.json)}`)
ok(`app recorded the withdraw — costBasisAtomic=${wdRecord.json.costBasisAtomic}`)

console.log('\n⑥ Read back /api/gateway/position once more — cost basis should have reduced proportionally, not vanished')
const posAfterWithdraw = await getPosition()
console.log(`    GET /api/gateway/position → ${posAfterWithdraw.status}`, JSON.stringify(posAfterWithdraw.json))
const p2 = posAfterWithdraw.json.position ?? posAfterWithdraw.json
if (p2?.costBasisComplete === false) die('position reports costBasisComplete:false after the withdraw — orphaned-row bug reproduced on the withdraw path')
const basisAfterWithdraw = BigInt(String(p2?.costBasisAtomic ?? p2?.entryNav ?? '0'))
if (basisAfterWithdraw <= 0n || basisAfterWithdraw >= basisAfterDeposit) die(`cost basis after 50% withdraw (${basisAfterWithdraw}) did not reduce proportionally from ${basisAfterDeposit}`)
ok(`cost basis correctly reduced: ${u6(basisAfterDeposit)} → ${u6(basisAfterWithdraw)} tUSDG`)

console.log(`\n✓ E2E PASSED — real deposit + withdraw, both recorded correctly through the live app API at ${API_BASE}, cost basis tracked end-to-end (position_manager resolved correctly — the orphaned-row bug is NOT present in this code).\n`)

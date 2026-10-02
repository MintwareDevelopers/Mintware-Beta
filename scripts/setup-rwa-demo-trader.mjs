// V2-RWAs — provision the DEMO TRADER: a Privy server wallet (key in Privy's enclave) that the live-trade
// button (/api/rwa/live-trade) and scripts/rwa-demo-activity.mjs trade from. Idempotent:
//   1. create the wallet once → RWA_TRADER_PRIVY_WALLET_ID / _ADDRESS appended to the env file
//   2. the rwa seat (issuer) verifies it in the identity registry — it is a VERIFIED trader, like Dana/Eli
//   3. the rwa seat sends it a little gas and mints it testnet dUSD + property units
//   4. the trader approves the demo router for both
// TESTNET ONLY. Run:  node --env-file=.env.robinhood.local scripts/setup-rwa-demo-trader.mjs
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, parseUnits, formatEther, maxUint256, parseAbi, defineChain } from 'viem'
import { resolveRwaSigner } from './lib/rwaSigner.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = process.env.RWA_ENV_FILE ?? join(ROOT, '..', '..', '..', '.env.robinhood.local') // main checkout from the worktree
const RPC = process.env.RWA_RPC_URL ?? 'https://sepolia.base.org'
const d = JSON.parse(readFileSync(join(ROOT, 'config', 'rwaDemo.deployment.json'), 'utf8'))
const die = (m) => { console.error(`✗ ${m}`); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { PrivyClient } = await import('@privy-io/server-auth')
const { createViemAccount } = await import('@privy-io/server-auth/viem')
const privy = new PrivyClient(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET)

let walletId = process.env.RWA_TRADER_PRIVY_WALLET_ID
let address = process.env.RWA_TRADER_PRIVY_ADDRESS
if (!walletId || !address) {
  if (!existsSync(ENV_FILE)) die(`env file not found: ${ENV_FILE} (set RWA_ENV_FILE)`)
  const w = await privy.walletApi.create({ chainType: 'ethereum' })
  walletId = w.id; address = w.address
  appendFileSync(ENV_FILE, `\n# V2-RWAs demo trader (verified, testnet) — created ${new Date().toISOString().slice(0, 10)}\nRWA_TRADER_PRIVY_WALLET_ID=${walletId}\nRWA_TRADER_PRIVY_ADDRESS=${address}\n`)
  console.log(`✓ created demo trader wallet ${address}`)
} else console.log(`· demo trader wallet ${address}`)

const chain = defineChain({ id: d.chainId, name: `chain-${d.chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const { account: seat } = await resolveRwaSigner()
const trader = await createViemAccount({ walletId, address, privy })
const ws = createWalletClient({ account: seat, chain, transport: http(RPC) })
const wt = createWalletClient({ account: trader, chain, transport: http(RPC) })

const REG = parseAbi(['function setVerified(address,uint64)', 'function isVerified(address) view returns (bool)'])
const ERC = parseAbi(['function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)'])
const c = d.contracts

async function tx(w, label, req) {
  const est = await pub.estimateContractGas({ ...req, account: w.account }).catch(() => 200_000n)
  const hash = await w.writeContract({ ...req, gas: (est * 16n) / 10n + 30_000n })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') die(`${label} reverted ${hash}`)
  console.log(`✓ ${label}  ${hash}`)
  await sleep(2500)
}

if (!(await pub.readContract({ address: c.registry, abi: REG, functionName: 'isVerified', args: [address] }))) {
  await tx(ws, 'verify the demo trader', { address: c.registry, abi: REG, functionName: 'setVerified', args: [address, BigInt(Math.floor(Date.now() / 1000) + 365 * 86400)] })
}
if ((await pub.getBalance({ address })) < 300_000_000_000_000n) {
  const hash = await ws.sendTransaction({ to: address, value: 500_000_000_000_000n })
  await pub.waitForTransactionReceipt({ hash }); console.log(`✓ gas → trader  ${hash}`); await sleep(2500)
}
if ((await pub.readContract({ address: c.usd, abi: ERC, functionName: 'balanceOf', args: [address] })) < parseUnits('5000', 6)) {
  await tx(ws, 'mint 20,000 dUSD → trader', { address: c.usd, abi: ERC, functionName: 'mint', args: [address, parseUnits('20000', 6)] })
}
if ((await pub.readContract({ address: c.property, abi: ERC, functionName: 'balanceOf', args: [address] })) < parseUnits('20', 18)) {
  await tx(ws, `mint 100 ${d.property.symbol} → trader`, { address: c.property, abi: ERC, functionName: 'mint', args: [address, parseUnits('100', 18)] })
}
for (const [label, token] of [['dUSD', c.usd], [d.property.symbol, c.property]]) {
  if ((await pub.readContract({ address: token, abi: ERC, functionName: 'allowance', args: [address, c.router] })) < maxUint256 / 2n) {
    await tx(wt, `trader approves router (${label})`, { address: token, abi: ERC, functionName: 'approve', args: [c.router, maxUint256] })
  }
}
console.log(`\n✓ demo trader ready: ${address} — gas ${formatEther(await pub.getBalance({ address }))} ETH`)
console.log('  Set RWA_TRADER_PRIVY_WALLET_ID + RWA_TRADER_PRIVY_ADDRESS on the server env for /api/rwa/live-trade.')

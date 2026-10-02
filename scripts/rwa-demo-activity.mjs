// V2-RWAs — keep the demo market alive: every RWA_ACTIVITY_SECS (default 240 s, ± jitter) the verified
// demo-trader Privy wallet places ONE small real trade on Base Sepolia, leaning toward the appraisal
// (below → buy, above → sell). Same sizing as lib/rwa/liveTrade.ts#planTrade. Stops on Ctrl-C, or after
// RWA_ACTIVITY_MAX trades. Testnet only — valueless tokens; each trade costs a few hundred-thousandths of an ETH.
//
// Run before / during a demo:  node --env-file=.env.robinhood.local scripts/rwa-demo-activity.mjs
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, formatEther } from 'viem'
import { baseSepolia } from 'viem/chains'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const d = JSON.parse(readFileSync(join(ROOT, 'config', 'rwaDemo.json'), 'utf8'))
const RPC = process.env.RWA_RPC_URL ?? 'https://sepolia.base.org'
const EVERY = Number(process.env.RWA_ACTIVITY_SECS ?? 240)
const MAX = Number(process.env.RWA_ACTIVITY_MAX ?? 1e9)
const { PRIVY_APP_ID, PRIVY_APP_SECRET, RWA_TRADER_PRIVY_WALLET_ID: walletId, RWA_TRADER_PRIVY_ADDRESS: address } = process.env
if (!PRIVY_APP_ID || !PRIVY_APP_SECRET || !walletId || !address) { console.error('✗ run scripts/setup-rwa-demo-trader.mjs first (needs RWA_TRADER_PRIVY_*)'); process.exit(1) }

const { PrivyClient } = await import('@privy-io/server-auth')
const { createViemAccount } = await import('@privy-io/server-auth/viem')
const account = await createViemAccount({ walletId, address, privy: new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET) })
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
const w = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) })

const HOOK = parseAbi(['function bandStatus() view returns (int24, int24, uint256, bool, bool, bool)', 'function tradingPaused() view returns (bool)'])
const VAULT = parseAbi(['function deployedFromSenior() view returns (uint256)'])
const ROUTER = parseAbi(['function swapExactIn((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bool zeroForOne, uint256 amountIn, uint256 minOut) returns (uint256)'])
const tickToUsd = (t) => (d.propertyIsCurrency0 ? Math.pow(1.0001, t) : 1 / Math.pow(1.0001, t)) * 1e12

function planTrade(spot, appraisal, poolUsd, rand = Math.random()) {
  const gap = (appraisal - spot) / appraisal
  const side = Math.abs(gap) < 0.004 ? (rand < 0.5 ? 'buy' : 'sell') : gap > 0 ? 'buy' : 'sell'
  const target = Math.abs(gap) < 0.004 ? 0.006 : Math.abs(gap) * (0.4 + 0.3 * rand)
  const usdIn = Math.min(250, Math.max(40, poolUsd * (Math.sqrt(1 + target) - 1)))
  return side === 'buy' ? { side, usd: usdIn } : { side, units: usdIn / spot }
}

console.log(`V2-RWAs demo activity — trader ${address} — every ~${EVERY}s`)
for (let n = 1; n <= MAX; n++) {
  try {
    const c = d.contracts
    const [band, paused, deployed] = await Promise.all([
      pub.readContract({ address: c.hook, abi: HOOK, functionName: 'bandStatus' }),
      pub.readContract({ address: c.hook, abi: HOOK, functionName: 'tradingPaused' }),
      pub.readContract({ address: c.vault, abi: VAULT, functionName: 'deployedFromSenior' }),
    ])
    if (paused || !band[5]) { console.log(`  · skipped (${paused ? 'paused' : 'appraisal stale'})`) }
    else {
      const spot = tickToUsd(Number(band[0])), appraisal = tickToUsd(Number(band[1]))
      const plan = planTrade(spot, appraisal, Number(deployed) / 1e6)
      const zeroForOne = plan.side === 'buy' ? !d.propertyIsCurrency0 : d.propertyIsCurrency0
      const amountIn = plan.side === 'buy' ? parseUnits(plan.usd.toFixed(2), 6) : parseUnits(plan.units.toFixed(4), 18)
      const req = { address: c.router, abi: ROUTER, functionName: 'swapExactIn', args: [d.poolKey, zeroForOne, amountIn, 0n], account }
      await pub.simulateContract(req)
      const est = await pub.estimateContractGas(req).catch(() => 400_000n)
      const hash = await w.writeContract({ ...req, gas: (est * 16n) / 10n + 30_000n })
      const r = await pub.waitForTransactionReceipt({ hash })
      console.log(`  ${r.status === 'success' ? '✓' : '✗'} #${n} ${plan.side} ${plan.side === 'buy' ? `${plan.usd.toFixed(2)} dUSD` : `${plan.units.toFixed(4)} ${d.property.symbol}`} @ spot $${spot.toFixed(2)} (appraisal $${appraisal.toFixed(2)})  ${hash}`)
    }
  } catch (e) {
    console.log(`  ✗ #${n} ${e.shortMessage ?? e.message}`)
  }
  if (n < MAX) await new Promise((r) => setTimeout(r, (EVERY * (0.7 + 0.6 * Math.random())) * 1000))
}
console.log(`done — trader gas left ${formatEther(await pub.getBalance({ address }))} ETH`)

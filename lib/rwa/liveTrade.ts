// V2-RWAs — execute ONE real demo trade from the verified demo-trader Privy wallet (server-only).
// Used by POST /api/rwa/live-trade (the "run a live trade" button). The trade leans toward the appraisal:
// below it → buy, above it → sell (a small random trade when already at it), sized to close part of the gap
// and clamped small, so the demo market stays anchored and inside the band. Testnet only.

// Server-only by construction: imported solely from app/api/rwa/live-trade/route.ts (it reads Privy secrets).
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, type Account } from 'viem'
import { baseSepolia } from 'viem/chains'
import { RWA_DEMO, tickToUsd } from './demo'

const RPC = process.env.RWA_RPC_URL ?? 'https://sepolia.base.org'
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC, { timeout: 10_000 }) })

const HOOK = parseAbi(['function bandStatus() view returns (int24, int24, uint256, bool, bool, bool)', 'function tradingPaused() view returns (bool)'])
const VAULT = parseAbi(['function deployedFromSenior() view returns (uint256)'])
const ROUTER = parseAbi(['function swapExactIn((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bool zeroForOne, uint256 amountIn, uint256 minOut) returns (uint256)'])

export type LiveTradeResult = { hash: string; side: 'buy' | 'sell'; amount: string; trader: string }

let traderAccount: Account | null = null
async function trader(): Promise<Account> {
  if (traderAccount) return traderAccount
  const { PRIVY_APP_ID, PRIVY_APP_SECRET, RWA_TRADER_PRIVY_WALLET_ID: walletId, RWA_TRADER_PRIVY_ADDRESS: address } = process.env
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET || !walletId || !address) throw new Error('trader_not_configured')
  const { PrivyClient } = await import('@privy-io/server-auth')
  const { createViemAccount } = await import('@privy-io/server-auth/viem')
  const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
  // Privy bundles its own viem copy, so its Account type is nominally distinct — same runtime shape.
  traderAccount = (await createViemAccount({ walletId, address: address as `0x${string}`, privy: privy as never })) as unknown as Account
  return traderAccount
}

/** Pure sizing: which side and how much, given spot, appraisal and the pool's USD depth. Exported for tests. */
export function planTrade(spotUsd: number, appraisalUsd: number, poolUsd: number, rand = Math.random()) {
  const gap = (appraisalUsd - spotUsd) / appraisalUsd
  const side: 'buy' | 'sell' = Math.abs(gap) < 0.004 ? (rand < 0.5 ? 'buy' : 'sell') : gap > 0 ? 'buy' : 'sell'
  // Constant-product: a USD amount Δy moves price by ≈ (1 + Δy/y)². Close ~half the gap, ± jitter.
  const target = Math.abs(gap) < 0.004 ? 0.006 : Math.abs(gap) * (0.4 + 0.3 * rand)
  const usdIn = Math.min(250, Math.max(40, poolUsd * (Math.sqrt(1 + target) - 1)))
  return side === 'buy' ? { side, usd: usdIn } : { side, units: usdIn / spotUsd }
}

let inFlight: Promise<LiveTradeResult> | null = null
let lastAt = 0

export async function runLiveTrade(): Promise<LiveTradeResult> {
  if (inFlight) throw new Error('trade_in_flight')
  if (Date.now() - lastAt < 12_000) throw new Error('cooldown')
  inFlight = (async () => {
    const c = RWA_DEMO.contracts
    const [band, paused, deployed] = await Promise.all([
      pub.readContract({ address: c.hook as `0x${string}`, abi: HOOK, functionName: 'bandStatus' }),
      pub.readContract({ address: c.hook as `0x${string}`, abi: HOOK, functionName: 'tradingPaused' }),
      pub.readContract({ address: c.vault as `0x${string}`, abi: VAULT, functionName: 'deployedFromSenior' }),
    ])
    if (paused) throw new Error('trading_paused')
    if (!band[5]) throw new Error('appraisal_stale')
    const plan = planTrade(tickToUsd(Number(band[0])), tickToUsd(Number(band[1])), Number(deployed) / 1e6)
    const propIs0 = RWA_DEMO.propertyIsCurrency0
    const zeroForOne = plan.side === 'buy' ? !propIs0 : propIs0
    const amountIn = plan.side === 'buy' ? parseUnits(plan.usd!.toFixed(2), 6) : parseUnits(plan.units!.toFixed(4), 18)

    const account = await trader()
    const req = {
      address: c.router as `0x${string}`, abi: ROUTER, functionName: 'swapExactIn' as const,
      args: [RWA_DEMO.poolKey as never, zeroForOne, amountIn, 0n] as const, account,
    }
    await pub.simulateContract(req)
    const est = await pub.estimateContractGas(req).catch(() => 400_000n)
    const hash = await createWalletClient({ account, chain: baseSepolia, transport: http(RPC) })
      .writeContract({ ...req, gas: (est * 16n) / 10n + 30_000n })
    const r = await pub.waitForTransactionReceipt({ hash })
    if (r.status !== 'success') throw new Error(`reverted:${hash}`)
    lastAt = Date.now()
    return {
      hash, side: plan.side, trader: account.address,
      amount: plan.side === 'buy' ? `${plan.usd!.toFixed(2)} dUSD` : `${plan.units!.toFixed(4)} ${RWA_DEMO.property.symbol}`,
    }
  })()
  try { return await inFlight } finally { inFlight = null }
}

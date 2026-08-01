// =============================================================================
// lib/web2/router/index.ts — meta-router orchestrator
//
// Ties the pieces together into one decision: kill-switch → listing → internal
// quote → normalize BOTH sides at a shared price → pickBest. Pure w.r.t. its
// injected dependencies (registry + reader), so it is fully testable without any
// network or chain access. Design: docs/developers/phase3-router-design.md §3–§6.
//
// The LI.FI side is passed in already-parsed (buyAmount + gas) so this module
// never depends on the LI.FI response shape — the caller (useQuote) adapts it.
// =============================================================================

import type { NetQuote, RouteDecision } from './types'
import { getListedPool, type PoolRegistry, EMPTY_REGISTRY } from './listing'
import { quoteInternalPool, valueUsd, type QuoterReader } from './internalQuote'
import { pickBest } from './pickBest'
import { isRouterEnabled, routerFeeBps, routerMinMarginBps } from './config'

/** The LI.FI quote, reduced to what the comparator needs. */
export interface LifiSide {
  /** Output the user receives (net of LI.FI's integrator fee), base units. */
  buyAmount: bigint
  /** Network fee estimate in USD, if the aggregator provided it. */
  gasCostUsd: number | null
}

export interface ResolveParams {
  chainId: number
  tokenIn: string
  tokenOut: string
  amountIn: bigint
  lifi: LifiSide
  /** Injected — defaults keep the router inert (empty registry, no reader). */
  registry?: PoolRegistry
  reader?: QuoterReader | null
  /** Test/override hooks; production reads these from env via config.ts. */
  enabled?: boolean
  feeBps?: number
  minMarginBps?: number
  /**
   * USD value of 1.0 whole buy token, derived from the LI.FI quote
   * (fromAmountUSD ÷ output-whole). When provided, BOTH sides are valued at this
   * single price so the comparison reflects the true output difference and needs
   * no external price oracle. Falls back to the pool's own price if omitted.
   */
  sharedBuyTokenPriceUsd?: number
}

/** Build a LI.FI NetQuote with no USD basis — used when nothing to compare against. */
function bareLifi(lifi: LifiSide): NetQuote {
  return {
    provider: 'lifi',
    buyAmount: lifi.buyAmount,
    buyAmountUsd: null,
    gasCostUsd: lifi.gasCostUsd,
    feeUsd: null,
    priceImpactPct: null,
  }
}

function lifiOnly(lifi: LifiSide, reason: RouteDecision['reason'], pool: RouteDecision['pool'] = null): RouteDecision {
  return { winner: 'lifi', reason, best: bareLifi(lifi), alternative: null, pool }
}

/**
 * Resolve the best route for a swap. Returns a decision naming the winner, the
 * chosen + alternative normalized quotes, and the target pool (for execution).
 *
 * Safety: every failure mode — disabled, unlisted, no reader, read error, missing
 * USD basis, tie — resolves to LI.FI. Internal only wins on a strict, gas-inclusive
 * user-net improvement. See pickBest for the invariant.
 */
export async function resolveSwapRoute(params: ResolveParams): Promise<RouteDecision> {
  const {
    chainId, tokenIn, tokenOut, amountIn, lifi,
    registry = EMPTY_REGISTRY,
    reader = null,
    enabled = isRouterEnabled(),
    feeBps = routerFeeBps(),
    minMarginBps = routerMinMarginBps(),
    sharedBuyTokenPriceUsd,
  } = params

  // 1. Kill switch — the router does nothing.
  if (!enabled) return lifiOnly(lifi, 'lifi-router-disabled')

  // 2. Is this pair listed on a MW pool?
  const pool = await getListedPool(chainId, tokenIn, tokenOut, registry)
  if (!pool) return lifiOnly(lifi, 'lifi-only-unlisted')

  // 3. Quote the pool (skims the router fee). Null → unavailable → LI.FI.
  const internal = await quoteInternalPool(pool, amountIn, feeBps, reader)
  if (!internal) return lifiOnly(lifi, 'lifi-internal-unavailable', pool)

  // 4. Value BOTH sides at ONE shared buy-token price so the comparison reflects
  //    the true output difference. Prefer the LI.FI-derived price (no oracle needed);
  //    fall back to the pool's own price. Re-valuing the internal side at the same
  //    price keeps both apples-to-apples.
  const dec   = internal.raw.buyTokenDecimals
  const price = sharedBuyTokenPriceUsd != null ? sharedBuyTokenPriceUsd : internal.raw.buyTokenPriceUsd

  const internalQuote: NetQuote = {
    ...internal.quote,
    buyAmountUsd: valueUsd(internal.quote.buyAmount, dec, price),
  }
  const lifiQuote: NetQuote = {
    provider: 'lifi',
    buyAmount: lifi.buyAmount,
    buyAmountUsd: valueUsd(lifi.buyAmount, dec, price),
    gasCostUsd: lifi.gasCostUsd,
    feeUsd: null,
    priceImpactPct: null,
  }

  // 5. Decide.
  const pick = pickBest(lifiQuote, internalQuote, { minMarginBps })
  if (pick.winner === 'mw-internal') {
    return { winner: 'mw-internal', reason: pick.reason, best: internalQuote, alternative: lifiQuote, pool }
  }
  return { winner: 'lifi', reason: pick.reason, best: lifiQuote, alternative: internalQuote, pool }
}

export type { RouteDecision, NetQuote, RouteProvider, ListedPool } from './types'
export { pickBest } from './pickBest'
export { getListedPool, staticRegistry, EMPTY_REGISTRY } from './listing'
export { applyRouterFee, ROUTER_FEE_BPS_DEFAULT, ROUTER_FEE_BPS_CAP, normalizeRouterFeeBps } from './fee'
export { isRouterEnabled, routerFeeBps } from './config'

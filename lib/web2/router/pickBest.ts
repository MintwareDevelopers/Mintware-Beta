// =============================================================================
// lib/web2/router/pickBest.ts — best-execution comparator (SAFETY-CRITICAL)
//
// INVARIANT (docs/developers/phase3-router-design.md §6, principle P1):
//   NEVER return the internal route unless it is STRICTLY better for the user,
//   measured user-net (output USD minus gas USD, both after fees). LI.FI wins
//   every tie, and wins whenever we cannot PROVE internal is better. Our own
//   router fee is already reflected in the internal quote's buyAmount, so taking
//   a cut can never make internal look better than it truly is.
//
// This file is pure. It is the single point where a user could be given a worse
// price, so it is deliberately conservative and exhaustively tested.
// =============================================================================

import type { NetQuote, RouteWinnerReason } from './types'

/** Price-impact ceiling (%) above which the internal pool is suppressed in favor
 *  of LI.FI (which can split across venues). Matches useQuote's highImpactWarning. */
export const INTERNAL_MAX_PRICE_IMPACT_PCT = 2

/** Default extra margin (bps of LI.FI net) internal must beat LI.FI by to win.
 *  0 = strict "greater than" (ties already go to LI.FI). Raise to bias harder
 *  toward the proven aggregator path. */
export const INTERNAL_MIN_MARGIN_BPS_DEFAULT = 0

export interface PickResult {
  winner: 'lifi' | 'mw-internal'
  reason: RouteWinnerReason
}

export interface PickOptions {
  /** Internal must exceed LI.FI user-net by more than this fraction of |lifiNet|. */
  minMarginBps?: number
}

function isFiniteNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v)
}

/** User-net USD value of a quote: output USD minus gas USD. Null when the output
 *  cannot be valued in USD (we then refuse to pick internal — see pickBest). */
function userNetUsd(q: NetQuote): number | null {
  if (!isFiniteNum(q.buyAmountUsd)) return null
  const gas = isFiniteNum(q.gasCostUsd) ? q.gasCostUsd : 0
  return q.buyAmountUsd - gas
}

/**
 * Decide between a LI.FI quote and an internal (MW-pool) quote.
 *
 * @param lifi     The LI.FI quote, or null if LI.FI produced nothing.
 * @param internal The internal quote, or null if the pair is unlisted / the pool
 *                 quote was unavailable.
 *
 * Guarantees:
 *  - internal wins ONLY when both sides have a USD basis AND internal's
 *    gas-inclusive user-net strictly exceeds LI.FI's by the margin.
 *  - any missing data, any tie, any high-impact internal → LI.FI.
 *  - the sole exception is LI.FI returning nothing: then a real internal quote
 *    is the only route, so it wins (better than failing the swap).
 */
export function pickBest(
  lifi: NetQuote | null,
  internal: NetQuote | null,
  opts: PickOptions = {},
): PickResult {
  // No internal option at all → LI.FI (the caller guarantees LI.FI is the live path).
  if (!internal) return { winner: 'lifi', reason: 'lifi-internal-unavailable' }

  // Internal exists but LI.FI failed — internal is the only real quote we have.
  // Its execution still enforces amountOutMinimum, so this is safe.
  if (!lifi) return { winner: 'mw-internal', reason: 'internal-only-lifi-failed' }

  // Suppress internal on high price impact — LI.FI may route across venues.
  if (isFiniteNum(internal.priceImpactPct) && internal.priceImpactPct > INTERNAL_MAX_PRICE_IMPACT_PCT) {
    return { winner: 'lifi', reason: 'lifi-internal-high-impact' }
  }

  const lifiNet = userNetUsd(lifi)
  const internalNet = userNetUsd(internal)

  // Cannot value BOTH sides in USD (gas-inclusive) → cannot prove internal is
  // better → LI.FI. This is the bulletproof default: we never pick internal on
  // a raw-output comparison that ignores gas.
  if (lifiNet == null || internalNet == null) {
    return { winner: 'lifi', reason: 'lifi-cannot-compare' }
  }

  const marginBps = opts.minMarginBps ?? INTERNAL_MIN_MARGIN_BPS_DEFAULT
  const threshold = Math.abs(lifiNet) * (marginBps / 10_000)

  if (internalNet > lifiNet + threshold) return { winner: 'mw-internal', reason: 'internal-better' }
  if (internalNet === lifiNet) return { winner: 'lifi', reason: 'lifi-tie' }
  return { winner: 'lifi', reason: 'lifi-better' }
}

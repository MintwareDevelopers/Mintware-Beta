// =============================================================================
// lib/web2/router/adapters.ts — bridge live quote shapes → the router engine
//
// The engine is decoupled from the LI.FI response shape on purpose (so it stays
// pure + testable). This is the ONE place that knows how to read a LI.FI quote,
// and it is exactly what useQuote calls in Slice 2:
//
//     const decision = await resolveSwapRoute({
//       chainId, tokenIn, tokenOut, amountIn,
//       lifi: lifiSideFromQuote(lifiQuote),
//       registry, reader,
//     })
//
// Keeping it here (tested) means Slice 2 wiring is a two-line change in useQuote.
// =============================================================================

import type { LifiSide } from './index'

/** The subset of a LI.FI quote the router needs. Matches provider `LifiQuote`. */
export interface LifiQuoteLike {
  /** Output the user receives, base units, net of LI.FI's integrator fee. */
  buyAmount: string
  /** USD cost of network fee, if the aggregator provided it. */
  gasCostUSD?: string | null
}

/** Safely parse a base-unit string to BigInt; 0n on any malformed value. */
function safeBigInt(v: string | undefined | null): bigint {
  if (!v) return 0n
  try {
    return BigInt(v)
  } catch {
    return 0n
  }
}

/** Convert a LI.FI quote into the engine's LifiSide input. Never throws. */
export function lifiSideFromQuote(q: LifiQuoteLike): LifiSide {
  const gas = q.gasCostUSD != null ? Number(q.gasCostUSD) : NaN
  return {
    buyAmount: safeBigInt(q.buyAmount),
    gasCostUsd: Number.isFinite(gas) ? gas : null,
  }
}

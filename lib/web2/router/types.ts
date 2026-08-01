// =============================================================================
// lib/web2/router/types.ts — MW meta-router (best-execution swap routing)
//
// The Router compares an internal quote (a Mintware V4 pool) against the LI.FI
// aggregator on *listed* pairs and returns whichever is better for the user,
// falling back to LI.FI otherwise. Design + rationale:
//   docs/developers/phase3-router-design.md
//
// These are the shared contracts. The on-chain execution (MWRouter.sol) and the
// V4 quoter reader land in Slice 2 — this module is the off-chain decision brain.
// =============================================================================

/** Which venue a swap routes through, decided per-quote (NOT per-chain). */
export type RouteProvider = 'lifi' | 'mw-internal'

/**
 * A Mintware V4 pool a listed pair can route against internally. Carries the full
 * V4 PoolKey (needed by BOTH the V4 Quoter to price and MWRouter to execute) plus
 * the router address. `currency0 < currency1` (V4 canonical sort order).
 */
export interface ListedPool {
  chainId: number
  /** MWRouter address — the on-chain execution target. */
  router: string
  /** MWSocialHook address bound to the pool (the PoolKey `hooks` field). */
  hooks: string
  currency0: string
  currency1: string
  /** V4 PoolKey fee (uint24; may carry the dynamic-fee flag). */
  fee: number
  /** V4 PoolKey tick spacing (int24). */
  tickSpacing: number
}

/**
 * Normalized, comparable form of a quote — everything pickBest needs and
 * nothing it doesn't. `buyAmount` is what the user actually receives, already
 * NET of that path's fee (LI.FI deducts its integrator fee before quoting;
 * the internal path skims the router fee off the output). So two NetQuotes for
 * the same buy token are directly comparable.
 */
export interface NetQuote {
  provider: RouteProvider
  /** Output the user receives, in buy-token base units, net of this path's fee. */
  buyAmount: bigint
  /** USD value of `buyAmount`, if known. Both sides are valued at the SAME
   *  buy-token price so the comparison reflects true output difference. */
  buyAmountUsd: number | null
  /** Network fee estimate in USD, if known. */
  gasCostUsd: number | null
  /** Fee taken on this path (router fee for internal; integrator fee for LI.FI),
   *  USD, if known. Informational — already reflected in `buyAmount`. */
  feeUsd: number | null
  /** Estimated price-impact %, if known. LI.FI aggregator returns null. */
  priceImpactPct: number | null
}

/** Why a particular provider won — surfaced for UI transparency + telemetry. */
export type RouteWinnerReason =
  | 'lifi-router-disabled'      // kill switch off → pure LI.FI
  | 'lifi-only-unlisted'        // no MW pool for this pair
  | 'lifi-internal-unavailable' // listed, but no internal quote (paused / read failed / out of band)
  | 'lifi-internal-high-impact' // internal suppressed on price impact — LI.FI may split
  | 'lifi-cannot-compare'       // couldn't prove internal better (missing USD basis) → LI.FI
  | 'lifi-tie'                  // exact user-net tie — LI.FI wins by policy
  | 'lifi-better'               // both quoted, LI.FI ≥ internal
  | 'internal-better'           // internal STRICTLY better, user-net (gas-inclusive)
  | 'internal-only-lifi-failed' // LI.FI produced no quote; internal is the only route

export interface RouteDecision {
  winner: RouteProvider
  reason: RouteWinnerReason
  /** The chosen quote (normalized). */
  best: NetQuote
  /** The losing option, if one was produced (for "also available via…" UI). */
  alternative: NetQuote | null
  /** The pool an internal quote targets, if any — needed for execution (Slice 2). */
  pool: ListedPool | null
}

// The rate-router "brain" (Phase 1b) — the missing piece that makes Mintware's idle capital SHOP across
// lending venues for the best *current* rate, instead of the static, curator-set weights the on-chain
// `MintwareMultiVenueYieldAdapter` uses today. It does NOT read rates itself; it's the pure decision
// layer an off-chain keeper feeds live rates into, then hands the result to `adapter.setVenues(...)`.
//
// Behaviour: rank venues by live APY, fill toward the best up to a per-venue cap (so it DIVERSIFIES across
// the top few — never all-in on one exotic venue), and leave an optional always-idle buffer. The cap
// mirrors the on-chain `maxVenueWeightBps` (PR #335), which is the enforced backstop; reading rates
// off-chain (from the live DefiLlama feed we already use) keeps rate-manipulation off the money path.
//
// Pure + deterministic (same inputs → same weights), so it's fully unit-testable. TESTNET/UNAUDITED; the
// keeper that calls `setVenues`/`rebalance` and the vault→adapter wiring are deploy-gated (see the
// yield-strategy roadmap, Phase 1b).

export const BPS = 10_000

export type VenueRate = {
  /** Stable venue id — the keeper maps this to the child adapter address for `setVenues`. */
  key: string
  label?: string
  /** Current supply/yield rate in bps (e.g. 500 = 5.00%). Non-finite venues are skipped. */
  apyBps: number
  /** false = skip this round (paused / full / de-listed). Defaults to true. */
  available?: boolean
  /** Optional per-venue cap (bps) tighter than the global `maxVenueBps` — the effective cap is the min of
   *  the two. Lets a caller risk-tier ONE venue (e.g. the risk gate throttling an elevated-risk venue)
   *  without lowering everyone's cap. Omit for the normal (global-cap) behaviour. */
  maxBpsOverride?: number
}

export type RateRouteOptions = {
  /** Per-venue cap in bps — mirror the on-chain `maxVenueWeightBps`. Default 4000 (40%). */
  maxVenueBps?: number
  /** Deliberately-idle, instant-withdraw buffer in bps (kept out of the deployable budget). Default 0. */
  idleBufferBps?: number
  /** Ignore venues paying below this (bps). Default 0. */
  minVenueApyBps?: number
  /** Consider only the top N venues by rate. Default: all eligible. */
  topN?: number
}

export type VenueWeight = { key: string; weightBps: number }

/**
 * Compute the best-rate-weighted allocation to hand to `MintwareMultiVenueYieldAdapter.setVenues(...)`.
 * Weights sum to at most `BPS - idleBufferBps`; no single venue exceeds `maxVenueBps`; venues are filled
 * highest-rate-first. Returns only venues that receive a non-zero weight (the remainder stays idle).
 */
export function computeBestRateWeights(venues: VenueRate[], opts: RateRouteOptions = {}): VenueWeight[] {
  const maxVenueBps = opts.maxVenueBps ?? 4_000
  const idleBufferBps = opts.idleBufferBps ?? 0
  const minVenueApyBps = opts.minVenueApyBps ?? 0

  if (!Number.isInteger(maxVenueBps) || maxVenueBps <= 0 || maxVenueBps > BPS) {
    throw new Error('maxVenueBps must be an integer in (0, 10000]')
  }
  if (!Number.isInteger(idleBufferBps) || idleBufferBps < 0 || idleBufferBps >= BPS) {
    throw new Error('idleBufferBps must be an integer in [0, 10000)')
  }

  const budget = BPS - idleBufferBps

  // Eligible venues, ranked by live rate (desc). Ties keep input order → deterministic.
  const ranked = venues
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.available !== false && Number.isFinite(v.apyBps) && v.apyBps >= minVenueApyBps)
    .sort((a, b) => (b.v.apyBps - a.v.apyBps) || (a.i - b.i))
    .map(({ v }) => v)

  const pool = opts.topN != null ? ranked.slice(0, Math.max(0, opts.topN)) : ranked

  const out: VenueWeight[] = []
  let remaining = budget
  for (const v of pool) {
    if (remaining <= 0) break
    // effective cap = min(global cap, this venue's optional tighter override). A non-finite override is
    // ignored (falls back to the global cap) so a garbage value can never produce a NaN weight.
    const cap = Number.isFinite(v.maxBpsOverride as number)
      ? Math.min(maxVenueBps, Math.max(0, v.maxBpsOverride as number))
      : maxVenueBps
    const w = Math.min(cap, remaining)
    if (w <= 0) continue
    out.push({ key: v.key, weightBps: w })
    remaining -= w
  }
  return out
}

/**
 * Convenience: map the live `/api/benchmarks/yields` feed rows (or any {key,label,apyPct} source) into
 * `VenueRate[]`. `apyPct` is a percentage (5.5 → 550 bps). Rows without a finite rate are dropped.
 */
export function venueRatesFromApyPct(
  rows: { key: string; label?: string; apyPct: number | null | undefined; available?: boolean }[],
): VenueRate[] {
  return rows
    .filter(r => r.apyPct != null && Number.isFinite(r.apyPct))
    .map(r => ({ key: r.key, label: r.label, apyBps: Math.round((r.apyPct as number) * 100), available: r.available }))
}

// The rate-keeper orchestration (Phase 1b) — turns live venue rates into the actual on-chain call.
// It sits between `rateRouter` (the pure allocation brain) and `MintwareMultiVenueYieldAdapter.setVenues`:
//   live rates (from the DefiLlama feed we already serve at /api/benchmarks/yields)
//     → computeBestRateWeights (rank + cap-bounded fill)
//       → planSetVenues() → the {adapters[], weightsBps[]} to submit.
// A `shouldReweight` drift guard keeps a keeper from re-weighting (and paying gas) on trivial rate moves.
//
// Pure + deterministic → unit-testable end-to-end. The keeper that actually SUBMITS the tx (and the
// vault→adapter wiring) is deploy-gated; this is the tested decision layer it runs. TESTNET/UNAUDITED.

import { computeBestRateWeights, venueRatesFromApyPct, type RateRouteOptions } from './rateRouter'

/** Static config: a venue key → the child `IYieldAdapter` address `setVenues` will point at. */
export type VenueConfig = { key: string; adapter: `0x${string}`; label?: string }

/** The exact args for `MintwareMultiVenueYieldAdapter.setVenues(adapters, weightsBps)`. */
export type SetVenuesPlan = { adapters: `0x${string}`[]; weightsBps: number[] }

/**
 * Build the `setVenues` plan from the configured venues + a live rate lookup (key → APY%). Venues with
 * no live rate (null/undefined) are treated as unavailable and left out. Options mirror `rateRouter`
 * (per-venue cap, idle buffer, minApy, topN).
 */
export function planSetVenues(
  venues: VenueConfig[],
  rateByKey: Record<string, number | null | undefined>,
  opts: RateRouteOptions = {},
): SetVenuesPlan {
  const rates = venueRatesFromApyPct(
    venues.map(v => ({ key: v.key, label: v.label, apyPct: rateByKey[v.key], available: rateByKey[v.key] != null })),
  )
  const weights = computeBestRateWeights(rates, opts)
  const byKey = new Map(venues.map(v => [v.key, v.adapter]))
  const out: SetVenuesPlan = { adapters: [], weightsBps: [] }
  for (const w of weights) {
    const adapter = byKey.get(w.key)
    if (!adapter) continue // config drift — skip a venue with no adapter mapping
    out.adapters.push(adapter)
    out.weightsBps.push(w.weightBps)
  }
  return out
}

/**
 * Should the keeper submit a re-weight? True only if the new plan differs from what's on-chain by more
 * than `minDeltaBps` on any venue (or the venue SET changed). Prevents gas churn on trivial rate drift.
 * `current` is the live on-chain allocation (adapter address → weightBps).
 */
export function shouldReweight(
  current: { adapter: `0x${string}`; weightBps: number }[],
  next: SetVenuesPlan,
  minDeltaBps = 500,
): boolean {
  const norm = (a: string) => a.toLowerCase()
  const cur = new Map(current.map(c => [norm(c.adapter), c.weightBps]))
  const nxt = new Map(next.adapters.map((a, i) => [norm(a), next.weightsBps[i]]))
  // Any venue added or removed → reweight.
  if (cur.size !== nxt.size) return true
  for (const k of nxt.keys()) if (!cur.has(k)) return true
  // Any per-venue weight moved by more than the threshold → reweight.
  for (const [k, w] of nxt) if (Math.abs((cur.get(k) ?? 0) - w) > minDeltaBps) return true
  return false
}

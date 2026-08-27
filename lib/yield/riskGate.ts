// v1 — venue RISK GATING (the circuit breaker), layered on the v0 best-rate allocator (rateRouter.ts).
//
// What it is (plainly): the allocator consumes an EXTERNAL risk-oracle signal per venue and applies it as
// a HARD CONSTRAINT before allocating. A venue the oracle flags `halt` is DEALLOCATED — weight forced to
// 0 — regardless of how attractive its rate is; an `elevated` venue is throttled to a tighter cap. So a
// deteriorating or compromised venue is exited before it can trap capital, not after.
//
// Why it's differentiated (a provable claim, not a yield claim): a pure rate-follower keeps chasing the
// rate until the rate itself is the trap (cf. the rsETH exploit, Apr 2026 — an attractive rate that was a
// blow-up in progress). Rate-following aggregators (Idle / Yearn / Beefy) have no risk-deterioration
// defense; curator vaults (Sommelier / Re7 / Steakhouse) react on a human's schedule, not in real time.
// This gate reacts the moment the oracle's signal changes.
//
// What it is NOT: this is deterministic rules over an external signal — disciplined risk management, not
// machine learning. The genuine learned model (predicting risk deterioration + rebalance-cost tradeoffs
// from historical protocol-failure data) is v2, a separate later chapter, and it will run STRICTLY inside
// these same guardrails. Do not label v0/v1 as AI.
//
// Pure + deterministic (same inputs → same output), fully unit-testable. TESTNET/UNAUDITED; the keeper
// that turns the result into setVenues()/rebalance() and the oracle feed itself are deploy-gated.

import { computeBestRateWeights, type VenueRate, type RateRouteOptions, type VenueWeight } from './rateRouter'

/** The external risk-oracle's per-venue verdict. `halt` = deallocate now; `elevated` = throttle; `ok` = normal. */
export type RiskLevel = 'ok' | 'elevated' | 'halt'

export type VenueRisk = {
  level: RiskLevel
  /** Oracle-supplied reason (audit/telemetry) — e.g. "collateral depeg", "oracle stale", "TVL outflow spike". */
  reason?: string
}

export type RiskGateOptions = RateRouteOptions & {
  /** Cap (bps) for an `elevated`-risk venue — tighter than the normal `maxVenueBps`. Default: half of it. */
  elevatedMaxVenueBps?: number
  /** Treat a MISSING risk signal as `halt` (fail-closed — safety over yield). Default true. */
  haltOnMissing?: boolean
}

export type RiskGatedResult = {
  /** The weights to hand to MintwareMultiVenueYieldAdapter.setVenues(...). */
  weights: VenueWeight[]
  /** Venues the breaker excluded this round, with the oracle's reason — for disclosure + telemetry. */
  halted: { key: string; reason?: string }[]
  /** Venues throttled to the tighter elevated cap (not excluded). */
  throttled: { key: string; reason?: string; capBps: number }[]
}

/**
 * Apply the risk oracle as a hard constraint, then allocate the survivors by best rate (v0). A `halt`
 * (or, by default, a missing signal) forces the venue's weight to 0 so the next setVenues()/rebalance()
 * pulls capital out of it — the circuit breaker. `elevated` keeps the venue but throttles its cap.
 */
export function computeRiskGatedWeights(
  venues: VenueRate[],
  riskByKey: Record<string, VenueRisk | undefined>,
  opts: RiskGateOptions = {},
): RiskGatedResult {
  const maxVenueBps = opts.maxVenueBps ?? 4_000
  const haltOnMissing = opts.haltOnMissing ?? true
  const elevatedMaxVenueBps = opts.elevatedMaxVenueBps ?? Math.floor(maxVenueBps / 2)

  if (!Number.isInteger(elevatedMaxVenueBps) || elevatedMaxVenueBps < 0) {
    throw new Error('elevatedMaxVenueBps must be a non-negative integer')
  }

  const halted: { key: string; reason?: string }[] = []
  const throttled: { key: string; reason?: string; capBps: number }[] = []

  const gated: VenueRate[] = []
  for (const v of venues) {
    const risk = riskByKey[v.key]
    const level: RiskLevel = risk?.level ?? (haltOnMissing ? 'halt' : 'ok')

    if (level === 'halt') {
      halted.push({ key: v.key, reason: risk?.reason ?? (risk ? undefined : 'no risk signal (fail-closed)') })
      continue // hard constraint: excluded from the allocation entirely
    }
    if (level === 'elevated') {
      const capBps = Math.min(maxVenueBps, elevatedMaxVenueBps)
      throttled.push({ key: v.key, reason: risk?.reason, capBps })
      gated.push({ ...v, maxBpsOverride: capBps })
      continue
    }
    gated.push(v) // 'ok' → normal
  }

  const weights = computeBestRateWeights(gated, opts)
  return { weights, halted, throttled }
}

// =============================================================================
// Attribution Engine v2 — normalization.
//
// Every signal maps a raw value into 0..1 with a whale-resistant, deterministic
// curve, then multiplies by its weight. Deterministic + standalone (no
// population needed) in v2.0; `percentileScore` is the seam for v2.1 where the
// curve is replaced by a real percentile within the scored population.
// =============================================================================

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/**
 * Saturating logarithmic curve. Returns 0 at value=0, ~0.5 at value=mid, and
 * approaches 1 as value→∞. Whale-resistant: 10× the input is NOT 10× the score.
 *   f(v) = 1 - 2^(-v/mid)
 */
export function logCurve(value: number, mid: number): number {
  if (value <= 0 || mid <= 0) return 0
  return clamp01(1 - Math.pow(2, -(value / mid)))
}

/** Linear ramp that saturates at `cap` (value>=cap → 1). */
export function linearCap(value: number, cap: number): number {
  if (value <= 0 || cap <= 0) return 0
  return clamp01(value / cap)
}

/**
 * Exponential recency decay. Returns 1 for activity today, 0.5 at `halfLifeDays`
 * ago, approaching 0 for long-dormant wallets.
 */
export function recencyDecay(lastSeenMs: number, nowMs: number, halfLifeDays: number): number {
  if (lastSeenMs <= 0 || nowMs <= lastSeenMs) return lastSeenMs > 0 ? 1 : 0
  const days = (nowMs - lastSeenMs) / 86_400_000
  return clamp01(Math.pow(0.5, days / halfLifeDays))
}

/** v2.1 seam: rank a value within a sorted population → percentile 0..1. */
export function percentileScore(value: number, sortedPopulation: number[]): number {
  if (sortedPopulation.length === 0) return 0
  let below = 0
  for (const v of sortedPopulation) {
    if (v < value) below++
    else break
  }
  return clamp01(below / sortedPopulation.length)
}

export const round = (x: number): number => Math.round(x)

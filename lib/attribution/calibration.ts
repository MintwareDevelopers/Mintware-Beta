// =============================================================================
// Attribution Engine v2 — calibration (true population percentiles + drift).
//
// The FICO discipline the research flags as the #1 methodology gap: percentiles
// must come from a REAL, representative scored population via a FROZEN empirical
// CDF — not a live-recomputed one (which would move a wallet's score when *other*
// people act) and not a fabricated distribution.
//
// This module is the MACHINERY. It ships NO distribution: `buildCalibrationArtifact`
// is what the operator backfill produces (≥200k–500k stratified wallets incl.
// dormant), and `percentileFromArtifact` is what the engine reads. Until a real
// artifact is dropped in, the engine stays on its labeled 'estimate' curve — so
// an estimate is never presented as a population percentile. `psi` monitors the
// frozen artifact for drift; PSI > 0.25 means recalibrate (new MINOR version).
// =============================================================================

export interface CalibrationArtifact {
  version: string        // model version this ECDF was frozen for
  basis: 'population' | 'seed'
  sampleSize: number
  // 101 knots: knots[p] = the composite score at the p-th percentile (p = 0..100).
  knots: number[]
  createdAtMs?: number
}

/** Linear-interpolated quantile of a sorted ascending array. q in [0,1]. */
export function quantile(sortedAsc: number[], q: number): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  if (n === 1) return sortedAsc[0]
  const pos = (n - 1) * Math.max(0, Math.min(1, q))
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sortedAsc[base + 1]
  return next === undefined ? sortedAsc[base] : sortedAsc[base] + rest * (next - sortedAsc[base])
}

/**
 * Build the frozen ECDF from a population of composite scores. This is the
 * operator backfill's output — freeze it, tag it to the model version, and the
 * engine reads it. Sample must be REPRESENTATIVE (stratified by chain / activity
 * / birth cohort, including dormant wallets) or every percentile is biased.
 */
export function buildCalibrationArtifact(
  compositeScores: number[],
  version: string,
  basis: 'population' | 'seed' = 'population',
  createdAtMs?: number,
): CalibrationArtifact {
  const sorted = [...compositeScores].sort((a, b) => a - b)
  const knots = Array.from({ length: 101 }, (_, p) => Math.round(quantile(sorted, p / 100)))
  return { version, basis, sampleSize: compositeScores.length, knots, createdAtMs }
}

/** Map a score to its 0..100 percentile against a frozen artifact (binary search). */
export function percentileFromArtifact(score: number, artifact: CalibrationArtifact): number {
  const { knots } = artifact
  if (knots.length === 0) return 0
  // Largest p such that knots[p] <= score.
  let lo = 0
  let hi = knots.length - 1
  if (score < knots[0]) return 0
  if (score >= knots[hi]) return 100
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (knots[mid] <= score) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Population Stability Index between an expected (frozen) and actual (fresh)
 * sample, binned by the expected distribution's deciles. PSI < 0.1 stable,
 * 0.1–0.25 watch, > 0.25 recalibrate.
 */
export function psi(expected: number[], actual: number[], bins = 10): number {
  if (expected.length === 0 || actual.length === 0) return 0
  const sorted = [...expected].sort((a, b) => a - b)
  const edges = Array.from({ length: bins - 1 }, (_, i) => quantile(sorted, (i + 1) / bins))
  const binOf = (v: number) => {
    let b = 0
    while (b < edges.length && v > edges[b]) b++
    return b
  }
  const eC = new Array(bins).fill(0)
  const aC = new Array(bins).fill(0)
  for (const v of expected) eC[binOf(v)]++
  for (const v of actual) aC[binOf(v)]++
  const EPS = 1e-6
  let total = 0
  for (let b = 0; b < bins; b++) {
    const e = Math.max(eC[b] / expected.length, EPS)
    const a = Math.max(aC[b] / actual.length, EPS)
    total += (a - e) * Math.log(a / e)
  }
  return total
}

// =============================================================================
// Attribution Engine v2 — calibration tests (percentiles, PSI, engine wiring).
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  buildCalibrationArtifact, percentileFromArtifact, quantile, psi,
} from './calibration'
import { computeScore } from './score'
import { GOLDEN_LONG_TERM_LP, NOW_MS } from './mockProvider'

// A synthetic population (for testing the MACHINERY — not a real backfill).
const population = Array.from({ length: 1000 }, (_, i) => i) // uniform 0..999
const artifact = buildCalibrationArtifact(population, 'attribution-v2.0.0-test')

describe('quantile', () => {
  it('interpolates and handles edges', () => {
    expect(quantile([10, 20, 30], 0)).toBe(10)
    expect(quantile([10, 20, 30], 1)).toBe(30)
    expect(quantile([10, 20, 30], 0.5)).toBe(20)
    expect(quantile([], 0.5)).toBe(0)
  })
})

describe('percentileFromArtifact', () => {
  it('has 101 knots and is monotonic', () => {
    expect(artifact.knots).toHaveLength(101)
    for (let i = 1; i < artifact.knots.length; i++) {
      expect(artifact.knots[i]).toBeGreaterThanOrEqual(artifact.knots[i - 1])
    }
  })
  it('maps values to sensible percentiles on a uniform population', () => {
    expect(percentileFromArtifact(-100, artifact)).toBe(0)
    expect(percentileFromArtifact(10_000, artifact)).toBe(100)
    expect(percentileFromArtifact(500, artifact)).toBeGreaterThanOrEqual(48)
    expect(percentileFromArtifact(500, artifact)).toBeLessThanOrEqual(52)
    expect(percentileFromArtifact(900, artifact)).toBeGreaterThan(percentileFromArtifact(100, artifact))
  })
})

describe('psi drift', () => {
  it('is ~0 for the same distribution and large for a shifted one', () => {
    const a = Array.from({ length: 1000 }, (_, i) => i)
    const same = Array.from({ length: 1000 }, (_, i) => i)
    const shifted = Array.from({ length: 1000 }, (_, i) => i + 400)
    expect(psi(a, same)).toBeLessThan(0.1)
    expect(psi(a, shifted)).toBeGreaterThan(0.25) // recalibrate threshold
  })
})

describe('computeScore percentile basis', () => {
  it("defaults to an 'estimate' percentile with no artifact", () => {
    const r = computeScore(GOLDEN_LONG_TERM_LP, NOW_MS)
    expect(r.percentileBasis).toBe('estimate')
  })
  it("uses the frozen ECDF and marks 'population' when a population artifact is supplied", () => {
    const pop = buildCalibrationArtifact(
      // a population where the LP's 743 sits near the top
      [...Array.from({ length: 900 }, (_, i) => i), ...Array.from({ length: 100 }, () => 750)],
      'attribution-v2.0.0-test',
    )
    const r = computeScore(GOLDEN_LONG_TERM_LP, NOW_MS, { calibration: pop })
    expect(r.percentileBasis).toBe('population')
    expect(r.percentile).toBe(percentileFromArtifact(r.score, pop))
    expect(r.percentile).toBeGreaterThan(70) // 743 sits ~74th in this population
  })
  it("a 'seed' artifact is NOT treated as population (stays an estimate)", () => {
    const seed = buildCalibrationArtifact(population, 'x', 'seed')
    const r = computeScore(GOLDEN_LONG_TERM_LP, NOW_MS, { calibration: seed })
    expect(r.percentileBasis).toBe('estimate')
  })
})

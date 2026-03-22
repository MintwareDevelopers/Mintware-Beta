import { describe, it, expect } from 'vitest'
import { computeMultipliers } from '@/lib/rewards/epochProcessor'

// SHARING_SCORE_MAX = 400 (from epochProcessor.ts)
// sharing_pct = Math.min(100, (sharing_score / 400) * 100)
// Band thresholds (both attribution and sharing use the same 0–33 / 34–66 / 67–100 bands):
//   sharing_score for pct = 34  → 400 * 0.34 = 136
//   sharing_score for pct = 67  → 400 * 0.67 = 268

const SHARING_SCORE_MAX = 400

// Helpers for computing boundary sharing scores
const sharingScoreForPct = (pct: number) => (pct / 100) * SHARING_SCORE_MAX

describe('computeMultipliers', () => {
  // -------------------------------------------------------------------------
  // Minimum multipliers (1.0 × 1.0 = 1.0)
  // -------------------------------------------------------------------------

  it('should return 1.0 × 1.0 combined for the lowest possible inputs (0, 0)', () => {
    const m = computeMultipliers(0, 0)
    expect(m.attribution).toBe(1.0)
    expect(m.sharing).toBe(1.0)
    expect(m.combined).toBe(1.0)
  })

  it('should return attribution=1.0 at percentile 0 (lower band boundary)', () => {
    expect(computeMultipliers(0, 0).attribution).toBe(1.0)
  })

  it('should return attribution=1.0 at percentile 33 (upper edge of lowest band)', () => {
    expect(computeMultipliers(33, 0).attribution).toBe(1.0)
  })

  // -------------------------------------------------------------------------
  // Attribution mid band: 34 ≤ percentile ≤ 66 → 1.25
  // -------------------------------------------------------------------------

  it('should return attribution=1.25 at percentile 34 (lower boundary of mid band)', () => {
    expect(computeMultipliers(34, 0).attribution).toBe(1.25)
  })

  it('should return attribution=1.25 at percentile 50 (middle of mid band)', () => {
    expect(computeMultipliers(50, 0).attribution).toBe(1.25)
  })

  it('should return attribution=1.25 at percentile 66 (upper edge of mid band)', () => {
    expect(computeMultipliers(66, 0).attribution).toBe(1.25)
  })

  // -------------------------------------------------------------------------
  // Attribution top band: ≥ 67 → 1.5
  // -------------------------------------------------------------------------

  it('should return attribution=1.5 at percentile 67 (lower boundary of top band)', () => {
    expect(computeMultipliers(67, 0).attribution).toBe(1.5)
  })

  it('should return attribution=1.5 at percentile 100', () => {
    expect(computeMultipliers(100, 0).attribution).toBe(1.5)
  })

  // -------------------------------------------------------------------------
  // Sharing bands — driven by sharing_pct = (sharing_score / 400) * 100
  // -------------------------------------------------------------------------

  it('should return sharing=1.0 when sharing_score gives pct < 34', () => {
    // pct = 33 → sharing_score = 132
    const score = sharingScoreForPct(33)
    expect(computeMultipliers(0, score).sharing).toBe(1.0)
  })

  it('should return sharing=1.15 when sharing_score puts pct at exactly 34', () => {
    // pct = 34 → sharing_score = 136
    const score = sharingScoreForPct(34)
    expect(computeMultipliers(0, score).sharing).toBe(1.15)
  })

  it('should return sharing=1.15 when sharing_score gives pct in mid band (50%)', () => {
    const score = sharingScoreForPct(50)
    expect(computeMultipliers(0, score).sharing).toBe(1.15)
  })

  it('should return sharing=1.15 when sharing_score gives pct at 66', () => {
    const score = sharingScoreForPct(66)
    expect(computeMultipliers(0, score).sharing).toBe(1.15)
  })

  it('should return sharing=1.3 when sharing_score puts pct at exactly 67', () => {
    const score = sharingScoreForPct(67)
    expect(computeMultipliers(0, score).sharing).toBe(1.3)
  })

  it('should return sharing=1.3 at sharing_score = SHARING_SCORE_MAX (400)', () => {
    expect(computeMultipliers(0, SHARING_SCORE_MAX).sharing).toBe(1.3)
  })

  it('should return sharing=1.0 at sharing_score = 0', () => {
    expect(computeMultipliers(0, 0).sharing).toBe(1.0)
  })

  // -------------------------------------------------------------------------
  // Combined multiplier = attribution × sharing, rounded to 3dp
  // -------------------------------------------------------------------------

  it('should compute combined as attribution × sharing', () => {
    // 1.25 × 1.15 = 1.4375
    const m = computeMultipliers(50, sharingScoreForPct(50))
    expect(m.attribution).toBe(1.25)
    expect(m.sharing).toBe(1.15)
    expect(m.combined).toBe(Math.round(1.25 * 1.15 * 1000) / 1000)
  })

  it('should return maximum combined = 1.95 (1.5 × 1.3)', () => {
    const m = computeMultipliers(100, SHARING_SCORE_MAX)
    expect(m.attribution).toBe(1.5)
    expect(m.sharing).toBe(1.3)
    expect(m.combined).toBe(1.95)
  })

  it('should return minimum combined = 1.0 (1.0 × 1.0)', () => {
    const m = computeMultipliers(0, 0)
    expect(m.combined).toBe(1.0)
  })

  it('should return combined = 1.5 for top attribution band with lowest sharing (1.5 × 1.0)', () => {
    const m = computeMultipliers(100, 0)
    expect(m.combined).toBe(1.5)
  })

  it('should return combined = 1.3 for lowest attribution band with top sharing (1.0 × 1.3)', () => {
    const m = computeMultipliers(0, SHARING_SCORE_MAX)
    expect(m.combined).toBe(1.3)
  })

  it('should return combined = 1.25 for mid attribution with lowest sharing (1.25 × 1.0)', () => {
    const m = computeMultipliers(50, 0)
    expect(m.combined).toBe(1.25)
  })

  it('should round combined to exactly 3 decimal places', () => {
    // 1.25 × 1.15 = 1.4375 — rounds to 1.438 at 3dp
    const m = computeMultipliers(50, sharingScoreForPct(50))
    const str = m.combined.toString()
    const decimalPart = str.split('.')[1] ?? ''
    expect(decimalPart.length).toBeLessThanOrEqual(3)
  })

  // -------------------------------------------------------------------------
  // Edge: percentile > 100 is clamped to top band (≥67 branch handles it)
  // -------------------------------------------------------------------------

  it('should clamp attribution to 1.5 when percentile exceeds 100', () => {
    // No explicit clamp in the source — percentile > 100 still ≥ 67, so 1.5
    expect(computeMultipliers(150, 0).attribution).toBe(1.5)
  })

  // -------------------------------------------------------------------------
  // Edge: sharing_score > SHARING_SCORE_MAX is clamped via Math.min(100, ...)
  // -------------------------------------------------------------------------

  it('should clamp sharing to 1.3 when sharing_score exceeds SHARING_SCORE_MAX', () => {
    // sharing_pct = Math.min(100, (800 / 400) * 100) = Math.min(100, 200) = 100 → 1.3
    expect(computeMultipliers(0, 800).sharing).toBe(1.3)
  })

  it('should produce the same result for sharing_score = 401 as for sharing_score = 400', () => {
    const atMax = computeMultipliers(50, SHARING_SCORE_MAX)
    const overMax = computeMultipliers(50, SHARING_SCORE_MAX + 1)
    expect(overMax.sharing).toBe(atMax.sharing)
    expect(overMax.combined).toBe(atMax.combined)
  })

  // -------------------------------------------------------------------------
  // use_score_multiplier=false path — flat 1.0 × 1.0 for all participants
  // This path is handled in processEpoch (not inside computeMultipliers itself),
  // so we verify computeMultipliers still returns its normal values and the
  // caller is responsible for the bypass.
  // -------------------------------------------------------------------------

  it('should still return a normal multiplier when called with top-band inputs regardless of campaign flag', () => {
    // computeMultipliers is unconditionally pure; the caller bypasses it when
    // use_score_multiplier=false. Verifying the function itself always computes.
    const m = computeMultipliers(67, sharingScoreForPct(67))
    expect(m.combined).toBe(1.95)
  })
})

// =============================================================================
// Attribution Engine v2 — sybil-risk scorer tests.
// Locks: clean wallets aren't punished, a single weak signal only flags for
// review, a referral farm is penalized, and a graph-confirmed ring is near-certain.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { assessSybil, sybilRiskFlag, NO_SYBIL_SIGNAL, type SybilFeatures } from './sybil'
import { computeScore } from './score'
import { GOLDEN_LONG_TERM_LP, NOW_MS } from './mockProvider'

const feat = (over: Partial<SybilFeatures>): SybilFeatures => ({ ...NO_SYBIL_SIGNAL, ...over })

describe('assessSybil', () => {
  it('a clean wallet has zero severity and no reasons', () => {
    const a = assessSybil(NO_SYBIL_SIGNAL)
    expect(a.severity).toBe(0)
    expect(a.confirmedRing).toBe(false)
    expect(a.reasons).toHaveLength(0)
  })

  it('a single weak signal stays low (high precision — no false condemnation)', () => {
    const a = assessSybil(feat({ counterpartyDiversity: 0.1 }))
    expect(a.severity).toBeLessThan(0.15)
    expect(a.confirmedRing).toBe(false)
  })

  it('a referral farm (many one-shot referees, low entropy) is penalized', () => {
    const a = assessSybil(feat({ referralCount: 140, oneShotRefereePct: 0.95, referralTreeEntropy: 0.1 }))
    expect(a.severity).toBeGreaterThan(0.2)
    expect(a.reasons.some(r => r.code === 'referral_farm')).toBe(true)
  })

  it('a graph-confirmed ring is near-certain regardless of other signals', () => {
    const a = assessSybil(feat({ sharedFunderCount: 12, seqSimilarity: 0.9, temporalBatchFraction: 0.8 }))
    expect(a.confirmedRing).toBe(true)
    expect(a.severity).toBeGreaterThanOrEqual(0.9)
    expect(a.reasons.some(r => r.code === 'confirmed_ring')).toBe(true)
  })

  it('severity is always clamped to [0,1]', () => {
    const a = assessSybil(feat({
      sharedFunderCount: 999, activeRatio: 0, burstScore: 1, counterpartyDiversity: 0,
      roundtripRatio: 1, bridgeDump: true, referralCount: 500, oneShotRefereePct: 1,
      referralTreeEntropy: 0, temporalBatchFraction: 1, seqSimilarity: 1,
    }))
    expect(a.severity).toBeLessThanOrEqual(1)
    expect(a.severity).toBeGreaterThan(0.9)
  })
})

describe('sybilRiskFlag', () => {
  it('below minSeverity → no flag, needsReview instead of a penalty', () => {
    const { flag, needsReview } = sybilRiskFlag(feat({ counterpartyDiversity: 0.1 }))
    expect(flag).toBeNull()
    expect(needsReview).toBe(true)
  })

  it('a confirmed ring produces a high-severity sybil_cluster flag', () => {
    const { flag } = sybilRiskFlag(feat({ sharedFunderCount: 12, seqSimilarity: 0.9, temporalBatchFraction: 0.8 }))
    expect(flag).not.toBeNull()
    expect(flag!.type).toBe('sybil_cluster')
    expect(flag!.severity).toBeGreaterThanOrEqual(0.9)
  })

  it('composes with the engine: the flag deducts from the score', () => {
    const { flag } = sybilRiskFlag(feat({ sharedFunderCount: 12, seqSimilarity: 0.9, temporalBatchFraction: 0.8 }))
    const clean = computeScore(GOLDEN_LONG_TERM_LP, NOW_MS)
    const flagged = computeScore({ ...GOLDEN_LONG_TERM_LP, riskFlags: [flag!] }, NOW_MS)
    expect(flagged.score).toBeLessThan(clean.score)
    expect(flagged.riskPenalty).toBeGreaterThan(0)
  })
})

// =============================================================================
// Legacy `/score` compat adapter — real-derived fields, no fabricated numbers.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { toLegacyScore } from './legacyShape'
import { computeScore } from './score'
import { GOLDEN_LONG_TERM_LP, NOW_MS } from './mockProvider'

const legacy = toLegacyScore(computeScore(GOLDEN_LONG_TERM_LP, NOW_MS), GOLDEN_LONG_TERM_LP, NOW_MS)

describe('toLegacyScore', () => {
  it('carries the core score fields', () => {
    expect(legacy.score).toBe(743)
    expect(legacy.tier).toBe('gold')
    expect(typeof legacy.percentile).toBe('number')
    expect(legacy.chains).toBe(GOLDEN_LONG_TERM_LP.chains.length)
    expect(legacy.totalTxCount).toBe(GOLDEN_LONG_TERM_LP.totalTxCount)
  })

  it('derives wallet age + firstSeen from real firstSeenMs (4yr LP → years)', () => {
    expect(legacy.walletAge).toMatch(/years/)
    expect(legacy.firstSeen).toMatch(/\d{4}/)
  })

  it('excludes the risk pseudo-signal from the signals list', () => {
    expect(legacy.signals.some(s => s.key === 'risk')).toBe(false)
    expect(legacy.signals.length).toBe(7)
  })

  it('does NOT fabricate the earnings range or opportunities/timeline', () => {
    expect(legacy.totalLo).toBe(0)
    expect(legacy.totalHi).toBe(0)
    expect(legacy.uvOpportunities).toEqual([])
    expect(legacy.timeline).toEqual([])
  })

  it('maps holdings → projects and referrals → tree, and sets a character', () => {
    expect(legacy.projects.length).toBeGreaterThan(0)
    expect(legacy.projects[0]).toHaveProperty('symbol')
    expect(legacy.treeSize).toBe(GOLDEN_LONG_TERM_LP.referrals.length)
    expect(legacy.character.label).toBe('Oracle') // gold tier
  })

  it('a brand-new wallet degrades cleanly', () => {
    const empty = { ...GOLDEN_LONG_TERM_LP, firstSeenMs: 0, positions: [], referrals: [] }
    const l = toLegacyScore(computeScore(empty, NOW_MS), empty, NOW_MS)
    expect(l.walletAge).toBe('new')
    expect(l.projects).toEqual([])
    expect(l.treeQuality).toBe('0.00')
  })
})

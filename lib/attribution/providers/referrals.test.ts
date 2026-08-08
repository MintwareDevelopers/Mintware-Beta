// =============================================================================
// Referral-DB Network adapter — pure-mapper tests (no Supabase needed).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { mapReferralsToNetwork, type ReferralRecordRow, type WalletProfileRow } from './referrals'
import { sybilRiskFlag } from '../sybil'
import { computeScore } from '../score'
import { GOLDEN_NEWCOMER } from '../mockProvider'

const NOW = Date.UTC(2025, 0, 1)
const recentIso = new Date(NOW - 5 * 86_400_000).toISOString()
const staleIso = new Date(NOW - 200 * 86_400_000).toISOString()

const profiles = (rows: Array<[string, string | null]>) =>
  new Map<string, WalletProfileRow>(rows.map(([a, seen]) => [a.toLowerCase(), { address: a, last_seen_at: seen }]))

describe('mapReferralsToNetwork', () => {
  it('scores genuinely retained referees high and pending ones as dust', () => {
    const records: ReferralRecordRow[] = [
      { referred: '0xA', status: 'active' },
      { referred: '0xB', status: 'active' },
      { referred: '0xC', status: 'pending' },
    ]
    const p = profiles([['0xA', recentIso], ['0xB', staleIso], ['0xC', null]])
    const { referrals, sybilFeatures } = mapReferralsToNetwork({ records, profiles: p, nowMs: NOW })

    expect(referrals[0]).toEqual({ referredScore: 250, retained: true })   // active + recent
    expect(referrals[1]).toEqual({ referredScore: 60, retained: false })   // active + stale
    expect(referrals[2]).toEqual({ referredScore: 5, retained: false })    // pending → dust
    expect(sybilFeatures.referralCount).toBe(3)
    expect(sybilFeatures.oneShotRefereePct).toBeCloseTo(2 / 3)
  })

  it('a pending-referee farm barely moves Network and does not confirm a ring', () => {
    const records: ReferralRecordRow[] = Array.from({ length: 120 }, (_, i) => ({ referred: `0x${i}`, status: 'pending' }))
    const { referrals, sybilFeatures } = mapReferralsToNetwork({ records, profiles: new Map(), nowMs: NOW })

    // 120 dust referees: qualitySum = 120·5·0.5 = 300 → Network stays low (log-curved, mid 1200).
    const network = computeScore({ ...GOLDEN_NEWCOMER, referrals }, NOW).signals.find(s => s.key === 'network')!
    expect(network.score).toBeLessThan(20)
    expect(sybilFeatures.oneShotRefereePct).toBe(1)
    expect(sybilRiskFlag(sybilFeatures).assessment.confirmedRing).toBe(false) // needs on-chain corroboration
  })

  it('genuine retained referees produce a real Network score', () => {
    const records: ReferralRecordRow[] = Array.from({ length: 8 }, (_, i) => ({ referred: `0x${i}`, status: 'active' }))
    const p = profiles(records.map(r => [r.referred!, recentIso]))
    const { referrals } = mapReferralsToNetwork({ records, profiles: p, nowMs: NOW })
    const network = computeScore({ ...GOLDEN_NEWCOMER, referrals }, NOW).signals.find(s => s.key === 'network')!
    expect(network.score).toBeGreaterThan(40) // 8·250 = 2000 qualitySum
  })

  it('handles no referrals', () => {
    const { referrals, sybilFeatures } = mapReferralsToNetwork({ records: [], profiles: new Map(), nowMs: NOW })
    expect(referrals).toEqual([])
    expect(sybilFeatures.oneShotRefereePct).toBe(0)
  })
})

// =============================================================================
// Tests for the RWA hold-snapshot engine (R4) + duration-match bonus (R5).
// Covers the pure math (computeHoldPoints / durationMatchMultiplier) and the
// idempotent DB writer (processHoldSnapshot) against a mock supabase.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import {
  computeHoldPoints,
  durationMatchMultiplier,
  holdConfigFromCampaign,
  processHoldSnapshot,
  DURATION_MATCH_BONUS,
  DEFAULT_HOLD_RATE,
  HOLD_SNAPSHOT_DAYS,
  type HoldConfig,
  type HoldInput,
} from './holdSnapshot'
import type { Campaign } from './types'

// Attribution max composite (matches holdSnapshot's percentile proxy).
const ATTR_MAX = 925

const baseCfg: HoldConfig = {
  pointsPerUnitPerDay: 1,
  durationDays: 7,
  useScoreMultiplier: false,
  durationMatchDays: null,
}

const holder = (over: Partial<HoldInput> = {}): HoldInput => ({
  wallet: '0xabc',
  balance: 1000,
  attribution_score: 0,
  sharing_score: 0,
  lockDays: 0,
  ...over,
})

describe('durationMatchMultiplier (R5)', () => {
  it('returns 1.0 when no requirement is set', () => {
    expect(durationMatchMultiplier(365, null)).toBe(1.0)
    expect(durationMatchMultiplier(365, 0)).toBe(1.0)
  })
  it('returns 1.0 when the lock is below the requirement', () => {
    expect(durationMatchMultiplier(29, 30)).toBe(1.0)
    expect(durationMatchMultiplier(0, 30)).toBe(1.0)
  })
  it('returns the bonus when the lock meets or exceeds the requirement', () => {
    expect(durationMatchMultiplier(30, 30)).toBe(DURATION_MATCH_BONUS)
    expect(durationMatchMultiplier(90, 30)).toBe(DURATION_MATCH_BONUS)
  })
})

describe('computeHoldPoints (R4)', () => {
  it('base case: rate × balance × days, no multiplier', () => {
    // 1 × 1000 × 7 = 7000
    expect(computeHoldPoints(holder(), baseCfg)).toBe(7000)
  })

  it('is zero for zero/negative balance', () => {
    expect(computeHoldPoints(holder({ balance: 0 }), baseCfg)).toBe(0)
    expect(computeHoldPoints(holder({ balance: -5 }), baseCfg)).toBe(0)
  })

  it('is zero for non-positive duration or rate', () => {
    expect(computeHoldPoints(holder(), { ...baseCfg, durationDays: 0 })).toBe(0)
    expect(computeHoldPoints(holder(), { ...baseCfg, pointsPerUnitPerDay: 0 })).toBe(0)
  })

  it('scales linearly with balance and duration', () => {
    expect(computeHoldPoints(holder({ balance: 2000 }), baseCfg)).toBe(14000)
    expect(computeHoldPoints(holder(), { ...baseCfg, durationDays: 14 })).toBe(14000)
  })

  it('applies the top attribution multiplier (1.5×) when enabled', () => {
    // attribution_score 925 → 100th pct → 1.5× attribution, sharing 0 → 1.0×
    const pts = computeHoldPoints(
      holder({ attribution_score: ATTR_MAX }),
      { ...baseCfg, useScoreMultiplier: true },
    )
    expect(pts).toBe(Math.round(7000 * 1.5))
  })

  it('does NOT apply the multiplier when disabled (flag off)', () => {
    const pts = computeHoldPoints(
      holder({ attribution_score: ATTR_MAX }),
      { ...baseCfg, useScoreMultiplier: false },
    )
    expect(pts).toBe(7000)
  })

  it('stacks attribution × sharing × duration-match', () => {
    // att 925→1.5×, sharing 400→ (400/400=100pct) 1.3×, lock 90≥30 → 1.5×
    const pts = computeHoldPoints(
      holder({ attribution_score: ATTR_MAX, sharing_score: 400, lockDays: 90 }),
      { ...baseCfg, useScoreMultiplier: true, durationMatchDays: 30 },
    )
    // combined score mult = round(1.5 × 1.3, 3dp) = 1.95 ; × 1.5 duration-match
    expect(pts).toBe(Math.round(7000 * 1.95 * 1.5))
  })

  it('withholds the duration-match bonus when the lock is short', () => {
    const locked = computeHoldPoints(holder({ lockDays: 30 }), { ...baseCfg, durationMatchDays: 30 })
    const unlocked = computeHoldPoints(holder({ lockDays: 10 }), { ...baseCfg, durationMatchDays: 30 })
    expect(locked).toBe(Math.round(7000 * DURATION_MATCH_BONUS))
    expect(unlocked).toBe(7000)
  })
})

describe('holdConfigFromCampaign', () => {
  const campaign = (over: Partial<Campaign>): Campaign => (over as Campaign)

  it('falls back to DEFAULT_HOLD_RATE and 7-day epoch', () => {
    const cfg = holdConfigFromCampaign(campaign({}))
    expect(cfg.pointsPerUnitPerDay).toBe(DEFAULT_HOLD_RATE)
    expect(cfg.durationDays).toBe(7)
    expect(cfg.useScoreMultiplier).toBe(false)
    expect(cfg.durationMatchDays).toBe(null)
  })

  it('reads rate/flag/duration-match, and IGNORES epoch_duration_days for the snapshot window', () => {
    const cfg = holdConfigFromCampaign(campaign({
      actions: { hold: { points: 3 } },
      epoch_duration_days: 30,          // must NOT leak into durationDays
      use_score_multiplier: true,
      duration_match_days: 90,
    }))
    expect(cfg).toEqual({
      pointsPerUnitPerDay: 3,
      durationDays: HOLD_SNAPSHOT_DAYS,  // fixed weekly cadence, not the 30-day epoch
      useScoreMultiplier: true,
      durationMatchDays: 90,
    })
  })
})

describe('processHoldSnapshot (atomic, idempotent writer)', () => {
  const campaign = { id: 'camp-1', actions: null, epoch_duration_days: 7 } as unknown as Campaign
  const holder = (wallet: string, balance: number): HoldInput =>
    ({ wallet, balance, attribution_score: 0, sharing_score: 0, lockDays: 0 })

  // Mock supabase.rpc. `credit_hold_points` returns { data: boolean } (true = newly credited,
  // false = already credited / idempotent no-op). `creditResults` supplies successive return
  // values (default true); `creditError` makes every credit call fail transiently.
  function mockSupabase({ creditResults = [] as boolean[], creditError = null as unknown } = {}) {
    let i = 0
    const calls = { credit: [] as Record<string, unknown>[], epoch: [] as Record<string, unknown>[] }
    const rpc = vi.fn(async (fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'credit_hold_points') {
        calls.credit.push(args)
        if (creditError) return { data: null, error: creditError }
        const v = i < creditResults.length ? creditResults[i] : true
        i++
        return { data: v, error: null }
      }
      if (fnName === 'increment_epoch_points') { calls.epoch.push(args); return { data: null, error: null } }
      return { data: null, error: null }
    })
    return { supabase: { rpc }, rpc, calls }
  }

  it('credits each holder once and accumulates the epoch total', async () => {
    const { supabase, rpc, calls } = mockSupabase()
    const res = await processHoldSnapshot(supabase, campaign, 1, '2026-07-28', [
      holder('0xa', 1000), holder('0xb', 500),
    ])
    // 7000 + 3500 = 10500
    expect(res).toEqual({ credited: 2, skipped: 0, totalPoints: 10500 })
    expect(calls.credit).toHaveLength(2)
    // 2 credit RPCs + 1 epoch increment
    expect(rpc).toHaveBeenCalledTimes(3)
    expect(rpc).toHaveBeenLastCalledWith('increment_epoch_points', { p_campaign_id: 'camp-1', p_delta: 10500 })
  })

  it('skips zero-point holders without touching the DB', async () => {
    const { supabase, rpc } = mockSupabase()
    const res = await processHoldSnapshot(supabase, campaign, 1, '2026-07-28', [holder('0xz', 0)])
    expect(res).toEqual({ credited: 0, skipped: 1, totalPoints: 0 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('never double-credits — an already-credited wallet (RPC returns false) is skipped', async () => {
    // Models a re-run (or an ambiguous post-commit failure on a prior run): the ON CONFLICT
    // guard returns false, so no epoch increment fires and totalPoints stays 0.
    const { supabase, calls } = mockSupabase({ creditResults: [false] })
    const res = await processHoldSnapshot(supabase, campaign, 1, '2026-07-28', [holder('0xa', 1000)])
    expect(res).toEqual({ credited: 0, skipped: 1, totalPoints: 0 })
    expect(calls.epoch).toHaveLength(0)  // nothing credited → epoch untouched
  })

  it('passes a campaign-scoped tx_hash to the RPC (no cross-campaign collision)', async () => {
    const { supabase, calls } = mockSupabase()
    // Same wallet, same date/epoch, two different campaigns — must send distinct tx_hashes.
    await processHoldSnapshot(supabase, { ...campaign, id: 'camp-A' } as Campaign, 1, '2026-07-28', [holder('0xa', 1000)])
    await processHoldSnapshot(supabase, { ...campaign, id: 'camp-B' } as Campaign, 1, '2026-07-28', [holder('0xa', 1000)])
    const [a, b] = calls.credit
    expect(String(a.p_tx_hash)).toContain('camp-A')
    expect(String(b.p_tx_hash)).toContain('camp-B')
    expect(a.p_tx_hash).not.toBe(b.p_tx_hash)
  })

  it('skips (no epoch bump) when the credit RPC errors transiently', async () => {
    const { supabase, calls } = mockSupabase({ creditError: { message: 'rpc timeout' } })
    const res = await processHoldSnapshot(supabase, campaign, 1, '2026-07-28', [holder('0xa', 1000)])
    expect(res).toEqual({ credited: 0, skipped: 1, totalPoints: 0 })
    expect(calls.epoch).toHaveLength(0)  // idempotent RPC → safe to retry next run, no partial epoch credit
  })
})

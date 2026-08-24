import { describe, it, expect, afterEach } from 'vitest'
import {
  computeStanding,
  tierFor,
  effectiveDailyCap,
  withinStandingDailyCap,
  softHeadroomCeiling,
  headroomFractionForTier,
  configuredHeadroomBaseFraction,
  CARD_HARD_DAILY_CAP_CEILING_USDC,
  CARD_HARD_PER_SWIPE_CEILING_USDC,
  NONE_STANDING,
  type SettledEventLike,
  type StandingTier,
} from './standing'
import { CARD_HIGH_VALUE_THRESHOLD } from './settleSwipe'

const DAY = 86_400_000
const at = (msFromEpoch: number) => new Date(msFromEpoch).toISOString()

/** n settled purchases spread one per day starting `spanStartDaysAgo` days apart from day 0. */
function settledOverDays(count: number, stepDays: number): SettledEventLike[] {
  const base = Date.parse('2026-01-01T12:00:00Z')
  return Array.from({ length: count }, (_, i) => ({
    decision: 'approved',
    settled: true,
    created_at: at(base + i * stepDays * DAY),
  }))
}

describe('computeStanding — tier derivation from settled spend only', () => {
  it('no events → none', () => {
    expect(computeStanding([])).toEqual(NONE_STANDING)
  })

  it('IGNORES declined and approved-but-unsettled events (spend-only)', () => {
    const events: SettledEventLike[] = [
      { decision: 'declined', settled: false, created_at: at(Date.parse('2026-01-01T00:00:00Z')) },
      { decision: 'declined', settled: true, created_at: at(Date.parse('2026-01-02T00:00:00Z')) }, // decline can't be settled, but assert it's ignored anyway
      { decision: 'approved', settled: false, created_at: at(Date.parse('2026-01-03T00:00:00Z')) }, // approved hold, not settled
      { decision: 'approved', settled: null, created_at: at(Date.parse('2026-01-04T00:00:00Z')) },
    ]
    const s = computeStanding(events)
    expect(s.settledCount).toBe(0)
    expect(s.tier).toBe('none')
  })

  it('a handful of settled purchases → active', () => {
    const s = computeStanding(settledOverDays(3, 1))
    expect(s.settledCount).toBe(3)
    expect(s.tier).toBe('active')
  })

  it('2 settled purchases is below the Active threshold → none', () => {
    expect(computeStanding(settledOverDays(2, 1)).tier).toBe('none')
  })

  it('sustained spend over weeks → established', () => {
    // 6 purchases across 6 distinct days spanning 25 days
    const events = settledOverDays(6, 5) // days 0,5,10,15,20,25 → span 25, distinct 6
    const s = computeStanding(events)
    expect(s.tier).toBe('established')
    expect(s.distinctDays).toBe(6)
    expect(s.spanDays).toBe(25)
  })

  it('a long consistent record → trusted', () => {
    // 15 purchases, one every 7 days → distinct 15, span 98 days
    const s = computeStanding(settledOverDays(15, 7))
    expect(s.tier).toBe('trusted')
    expect(s.spanDays).toBeGreaterThanOrEqual(90)
  })

  it('many purchases but all on ONE day → active, not established (sustained-ness matters)', () => {
    const base = Date.parse('2026-01-01T00:00:00Z')
    const events: SettledEventLike[] = Array.from({ length: 20 }, (_, i) => ({
      decision: 'approved',
      settled: true,
      created_at: at(base + i * 60_000), // 20 purchases within 20 minutes, same UTC day
    }))
    const s = computeStanding(events)
    expect(s.distinctDays).toBe(1)
    expect(s.spanDays).toBe(0)
    expect(s.tier).toBe('active') // count clears Active, but distinctDays/span fail Established+
  })
})

describe('tierFor — pure ladder edges', () => {
  it('trusted requires count AND distinct days AND span', () => {
    expect(tierFor({ settledCount: 15, distinctDays: 10, spanDays: 90 })).toBe('trusted')
    expect(tierFor({ settledCount: 15, distinctDays: 10, spanDays: 89 })).toBe('established') // span short → falls back
    expect(tierFor({ settledCount: 15, distinctDays: 9, spanDays: 90 })).toBe('established') // distinct short
  })
})

describe('Perk #1 — higher daily limit (Trusted): widen-only, hard-clamped', () => {
  const CONTRIBUTOR = 2_000_000_000n // $2,000/day

  it('base/none/active/established tiers leave the cap UNCHANGED', () => {
    for (const tier of ['none', 'active', 'established'] as StandingTier[]) {
      expect(effectiveDailyCap(CONTRIBUTOR, tier)).toBe(CONTRIBUTOR)
    }
  })

  it('trusted RAISES the cap (×1.5) but only within the absolute hard ceiling', () => {
    expect(effectiveDailyCap(CONTRIBUTOR, 'trusted')).toBe(3_000_000_000n) // $3,000
    // A large base cap × 1.5 clamps to the $50k hard ceiling, never above.
    const bigBase = 40_000_000_000n // $40k
    expect(effectiveDailyCap(bigBase, 'trusted')).toBe(CARD_HARD_DAILY_CAP_CEILING_USDC) // $50k, not $60k
  })

  it('NEVER removes a cap: owner (null) stays uncapped; vendor (0n) stays receive-only, even Trusted', () => {
    expect(effectiveDailyCap(null, 'trusted')).toBeNull()
    expect(effectiveDailyCap(0n, 'trusted')).toBe(0n)
    expect(withinStandingDailyCap(0n, 'trusted', 1n)).toBe(false) // a vendor can never be widened into a spender
  })

  it('is provably widen-only: effective cap is always >= base cap', () => {
    const bases = [1n, 2_000_000_000n, 25_000_000_000n, 49_999_999_999n, 80_000_000_000n]
    for (const base of bases) {
      for (const tier of ['none', 'active', 'established', 'trusted'] as StandingTier[]) {
        const eff = effectiveDailyCap(base, tier)!
        expect(eff >= base).toBe(true)
      }
    }
  })

  it('withinStandingDailyCap: a Trusted contributor can spend above the raw $2k cap, up to the raised cap', () => {
    // $2,500 is over the raw contributor cap but under the Trusted-raised $3,000 cap.
    expect(withinStandingDailyCap(CONTRIBUTOR, 'none', 2_500_000_000n)).toBe(false)
    expect(withinStandingDailyCap(CONTRIBUTOR, 'trusted', 2_500_000_000n)).toBe(true)
    // …but $3,000.000001 is still over even the raised cap.
    expect(withinStandingDailyCap(CONTRIBUTOR, 'trusted', 3_000_000_001n)).toBe(false)
  })
})

describe('Perk #2 — more headroom (Established): soft ceiling never exceeds the hard ceiling', () => {
  const HARD = CARD_HARD_PER_SWIPE_CEILING_USDC

  it('DISABLED by default (baseFraction >= 1) → null soft ceiling → today’s behavior for every tier', () => {
    for (const tier of ['none', 'active', 'established', 'trusted'] as StandingTier[]) {
      expect(softHeadroomCeiling(tier, HARD, 1)).toBeNull()
      expect(softHeadroomCeiling(tier, HARD, 1.5)).toBeNull() // any >= 1 disables
    }
  })

  it('when engaged (baseFraction < 1): higher tiers get MORE headroom, none of them exceed the hard ceiling', () => {
    const bf = 0.5
    const none = softHeadroomCeiling('none', HARD, bf)!
    const active = softHeadroomCeiling('active', HARD, bf)!
    const established = softHeadroomCeiling('established', HARD, bf)!
    const trusted = softHeadroomCeiling('trusted', HARD, bf)!

    expect(none).toBe(HARD / 2n) // 0.5 × $250 = $125
    expect(active).toBe(none)
    expect(established).toBeGreaterThan(none) // 0.75 × $250 = $187.50
    expect(established).toBe(187_500_000n)
    expect(trusted).toBe(HARD) // full ceiling

    // Invariant: NO tier ever exceeds the hard ceiling.
    for (const c of [none, active, established, trusted]) {
      expect(c <= HARD).toBe(true)
    }
  })

  it('headroomFractionForTier is always within [0,1] (soft can never exceed hard)', () => {
    for (const bf of [-1, 0, 0.25, 0.5, 0.9, 1, 2, NaN]) {
      for (const tier of ['none', 'active', 'established', 'trusted'] as StandingTier[]) {
        const f = headroomFractionForTier(tier, bf)
        expect(f).toBeGreaterThanOrEqual(0)
        expect(f).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is provably clamped: for any baseFraction < 1, ceiling <= hard for all tiers', () => {
    for (const bf of [0.01, 0.33, 0.5, 0.66, 0.99]) {
      for (const tier of ['none', 'active', 'established', 'trusted'] as StandingTier[]) {
        const c = softHeadroomCeiling(tier, HARD, bf)!
        expect(c <= HARD).toBe(true)
      }
    }
  })
})

describe('hard-ceiling constant stays in lockstep with the settle-time limit', () => {
  it('CARD_HARD_PER_SWIPE_CEILING_USDC === CARD_HIGH_VALUE_THRESHOLD (settleSwipe.ts)', () => {
    expect(CARD_HARD_PER_SWIPE_CEILING_USDC).toBe(CARD_HIGH_VALUE_THRESHOLD)
  })
})

describe('configuredHeadroomBaseFraction — env default is OFF', () => {
  const prev = process.env.CARD_SOFT_HEADROOM_BASE_FRACTION
  afterEach(() => {
    if (prev === undefined) delete process.env.CARD_SOFT_HEADROOM_BASE_FRACTION
    else process.env.CARD_SOFT_HEADROOM_BASE_FRACTION = prev
  })

  it('defaults to 1 (disabled) when unset or malformed', () => {
    delete process.env.CARD_SOFT_HEADROOM_BASE_FRACTION
    expect(configuredHeadroomBaseFraction()).toBe(1)
    process.env.CARD_SOFT_HEADROOM_BASE_FRACTION = 'not-a-number'
    expect(configuredHeadroomBaseFraction()).toBe(1)
  })

  it('reads a configured floor when set', () => {
    process.env.CARD_SOFT_HEADROOM_BASE_FRACTION = '0.5'
    expect(configuredHeadroomBaseFraction()).toBe(0.5)
  })
})

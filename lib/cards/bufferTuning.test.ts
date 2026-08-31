import { describe, it, expect } from 'vitest'
import { isqrt, computeDemandStats, blendToward, type DemandSwipe } from './bufferTuning'

const USDC = (n: number): bigint => BigInt(Math.round(n * 1_000_000))
const DAY = 86_400
const NOW = 30 * DAY // a fixed "now" so tests are deterministic (no Date.now)

describe('isqrt', () => {
  it('floors the square root', () => {
    expect(isqrt(0n)).toBe(0n)
    expect(isqrt(1n)).toBe(1n)
    expect(isqrt(15n)).toBe(3n)
    expect(isqrt(16n)).toBe(4n)
    expect(isqrt(10n ** 18n)).toBe(10n ** 9n)
  })
  it('throws on negative', () => { expect(() => isqrt(-1n)).toThrow() })
})

describe('computeDemandStats', () => {
  const base = { nowSecs: NOW, observationWindowSecs: 30 * DAY, sigmaPeriodSecs: DAY, leadTimeSecs: 60 }

  it('returns zeros with no history in-window', () => {
    const r = computeDemandStats({ ...base, swipes: [] })
    expect(r).toEqual({ meanLeadtimeAtomic: 0n, demandStdevAtomic: 0n, sampleCount: 0, periods: 0 })
  })

  it('mean lead-time demand = spend rate × T', () => {
    // $300 spent evenly over the full 30-day window → rate $10/day; over a 60s lead time that's tiny.
    // rate = 300e6 / (30*86400)s ; μ_L = rate × 60s.
    const swipes: DemandSwipe[] = Array.from({ length: 30 }, (_, i) => ({ amountAtomic: USDC(10), atSecs: i * DAY + 1 }))
    const r = computeDemandStats({ ...base, swipes })
    expect(r.sampleCount).toBe(30)
    // μ_L ≈ (300e6 × 60) / (30×86400) = 18000000/... → about $0.00694
    const expected = (USDC(300) * 60n) / BigInt(30 * DAY)
    expect(r.meanLeadtimeAtomic).toBe(expected)
  })

  it('a steady spender has LOWER σ than a bursty one for the same total', () => {
    // Steady: $10 every day for 30 days.
    const steady: DemandSwipe[] = Array.from({ length: 30 }, (_, i) => ({ amountAtomic: USDC(10), atSecs: i * DAY + 1 }))
    // Bursty: $300 all on one day, nothing the rest (same $300 total).
    const bursty: DemandSwipe[] = [{ amountAtomic: USDC(300), atSecs: 5 * DAY + 1 }]
    const s = computeDemandStats({ ...base, swipes: steady })
    const b = computeDemandStats({ ...base, swipes: bursty })
    expect(b.demandStdevAtomic).toBeGreaterThan(s.demandStdevAtomic)
    expect(s.demandStdevAtomic).toBe(0n) // perfectly even daily spend → zero per-day variance
  })

  it('ignores swipes outside the observation window', () => {
    const swipes: DemandSwipe[] = [
      { amountAtomic: USDC(50), atSecs: NOW - 5 * DAY }, // in window
      { amountAtomic: USDC(999), atSecs: NOW - 40 * DAY }, // older than 30d → excluded
    ]
    const r = computeDemandStats({ ...base, swipes })
    expect(r.sampleCount).toBe(1)
  })

  it('a short history is not diluted by the full window (rate uses the observed span)', () => {
    // Only 1 day of history ($60 today) — μ_L should reflect ~$60/day, not $60/30days.
    const swipes: DemandSwipe[] = [{ amountAtomic: USDC(60), atSecs: NOW - 100 }]
    const r = computeDemandStats({ ...base, swipes })
    // observedSpan floors at sigmaPeriodSecs (1 day); μ_L = 60e6 × 60 / 86400 ≈ $0.041
    expect(r.meanLeadtimeAtomic).toBe((USDC(60) * 60n) / BigInt(DAY))
  })
})

describe('blendToward (EMA convergence)', () => {
  it('takes the first measurement whole (existing 0)', () => {
    expect(blendToward(0n, USDC(100), 3000)).toBe(USDC(100))
  })
  it('moves partway toward the measurement at alpha', () => {
    // existing $100, measured $200, α=30% → 100 + 0.3×100 = $130
    expect(blendToward(USDC(100), USDC(200), 3000)).toBe(USDC(130))
  })
  it('alpha 0 keeps existing; alpha 10000 takes the measurement', () => {
    expect(blendToward(USDC(100), USDC(200), 0)).toBe(USDC(100))
    expect(blendToward(USDC(100), USDC(200), 10_000)).toBe(USDC(200))
  })
  it('converges downward too', () => {
    expect(blendToward(USDC(200), USDC(100), 5000)).toBe(USDC(150))
  })
})

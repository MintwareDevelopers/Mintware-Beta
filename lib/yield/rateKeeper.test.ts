import { describe, it, expect } from 'vitest'
import { planSetVenues, shouldReweight, type VenueConfig } from './rateKeeper'

const A = (n: number) => ('0x' + String(n).repeat(40).slice(0, 40)) as `0x${string}`
const venues: VenueConfig[] = [
  { key: 'aave', adapter: A(1) },
  { key: 'morpho', adapter: A(2) },
  { key: 'fluid', adapter: A(3) },
]

describe('planSetVenues', () => {
  it('maps best-rate weights onto the child adapter addresses', () => {
    const plan = planSetVenues(venues, { aave: 4, morpho: 6, fluid: 5 }, { maxVenueBps: 4_000 })
    // morpho (6%) 40%, fluid (5%) 40%, aave (4%) 20%
    expect(plan.adapters).toEqual([A(2), A(3), A(1)])
    expect(plan.weightsBps).toEqual([4_000, 4_000, 2_000])
  })

  it('drops venues with no live rate (unavailable)', () => {
    // 60% cap so both surviving venues appear: fluid (5%) 60%, aave (4%) 40%; morpho (null) excluded.
    const plan = planSetVenues(venues, { aave: 4, morpho: null, fluid: 5 }, { maxVenueBps: 6_000 })
    expect(plan.adapters).toEqual([A(3), A(1)]) // fluid then aave; morpho excluded
    expect(plan.weightsBps).toEqual([6_000, 4_000])
  })

  it('skips a venue with no adapter mapping (config drift), never emits a bad address', () => {
    const plan = planSetVenues([{ key: 'aave', adapter: A(1) }], { aave: 4, ghost: 9 } as never, { maxVenueBps: 10_000 })
    expect(plan.adapters).toEqual([A(1)])
    expect(plan.adapters.every(a => a.length === 42)).toBe(true)
  })

  it('produces valid setVenues args (equal-length arrays, Σ ≤ 10000)', () => {
    const plan = planSetVenues(venues, { aave: 4, morpho: 6, fluid: 5 }, { maxVenueBps: 3_500, idleBufferBps: 500 })
    expect(plan.adapters.length).toBe(plan.weightsBps.length)
    expect(plan.weightsBps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10_000)
  })

  it('empty when nothing has a rate (all capital stays idle)', () => {
    expect(planSetVenues(venues, {}, {})).toEqual({ adapters: [], weightsBps: [] })
  })
})

describe('shouldReweight', () => {
  const next = { adapters: [A(2), A(1)], weightsBps: [4_000, 4_000] }

  it('true when a venue is added or removed', () => {
    expect(shouldReweight([{ adapter: A(2), weightBps: 4_000 }], next)).toBe(true) // A(1) added
  })

  it('true when a weight moves beyond the threshold', () => {
    const cur = [{ adapter: A(2), weightBps: 4_000 }, { adapter: A(1), weightBps: 3_000 }]
    expect(shouldReweight(cur, next, 500)).toBe(true) // A(1): 3000 → 4000 (Δ 1000 > 500)
  })

  it('false on trivial drift within the threshold (no gas churn)', () => {
    const cur = [{ adapter: A(2), weightBps: 4_100 }, { adapter: A(1), weightBps: 3_900 }]
    expect(shouldReweight(cur, next, 500)).toBe(false) // both Δ = 100 ≤ 500
  })

  it('is case-insensitive on addresses', () => {
    const cur = [{ adapter: A(2).toUpperCase() as `0x${string}`, weightBps: 4_000 }, { adapter: A(1), weightBps: 4_000 }]
    expect(shouldReweight(cur, next, 500)).toBe(false)
  })
})

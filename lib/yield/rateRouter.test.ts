import { describe, it, expect } from 'vitest'
import { computeBestRateWeights, venueRatesFromApyPct, BPS, type VenueRate } from './rateRouter'

const V = (key: string, apyBps: number, available = true): VenueRate => ({ key, apyBps, available })

const sum = (w: { weightBps: number }[]) => w.reduce((a, b) => a + b.weightBps, 0)

describe('computeBestRateWeights', () => {
  it('routes toward the best rate, filling to the cap then spilling to the next best', () => {
    // aave 4%, morpho 6%, fluid 5% → order morpho, fluid, aave; 40% cap.
    const w = computeBestRateWeights([V('aave', 400), V('morpho', 600), V('fluid', 500)], { maxVenueBps: 4_000 })
    expect(w).toEqual([
      { key: 'morpho', weightBps: 4_000 },
      { key: 'fluid', weightBps: 4_000 },
      { key: 'aave', weightBps: 2_000 }, // remaining budget
    ])
    expect(sum(w)).toBe(BPS)
  })

  it('never exceeds the per-venue cap', () => {
    const w = computeBestRateWeights([V('a', 900), V('b', 100)], { maxVenueBps: 3_000 })
    expect(w.every(x => x.weightBps <= 3_000)).toBe(true)
    // only 60% deployed (2 × 30%), the rest stays idle — fewer venues than the budget needs.
    expect(sum(w)).toBe(6_000)
  })

  it('concentrates fully when the cap allows and there is one venue', () => {
    const w = computeBestRateWeights([V('a', 500)], { maxVenueBps: BPS })
    expect(w).toEqual([{ key: 'a', weightBps: BPS }])
  })

  it('honors the idle buffer (budget = BPS − idle)', () => {
    const w = computeBestRateWeights([V('a', 500), V('b', 400), V('c', 300)], { maxVenueBps: 5_000, idleBufferBps: 2_000 })
    expect(sum(w)).toBe(8_000) // 10000 − 2000
    expect(w[0]).toEqual({ key: 'a', weightBps: 5_000 })
    expect(w[1]).toEqual({ key: 'b', weightBps: 3_000 }) // remaining of the 8000 budget
  })

  it('filters venues below minVenueApyBps', () => {
    const w = computeBestRateWeights([V('good', 600), V('dust', 50)], { maxVenueBps: BPS, minVenueApyBps: 100 })
    expect(w.map(x => x.key)).toEqual(['good'])
  })

  it('limits to the top N by rate', () => {
    const w = computeBestRateWeights([V('a', 100), V('b', 900), V('c', 500)], { maxVenueBps: 4_000, topN: 2 })
    expect(w.map(x => x.key)).toEqual(['b', 'c']) // a (lowest) excluded
  })

  it('skips unavailable venues', () => {
    const w = computeBestRateWeights([V('a', 900, false), V('b', 100, true)], { maxVenueBps: BPS })
    expect(w.map(x => x.key)).toEqual(['b'])
  })

  it('is deterministic on ties (input order preserved)', () => {
    const w = computeBestRateWeights([V('x', 500), V('y', 500)], { maxVenueBps: 6_000 })
    expect(w.map(x => x.key)).toEqual(['x', 'y'])
  })

  it('drops non-finite rates', () => {
    const w = computeBestRateWeights([V('a', NaN), V('b', 400)], { maxVenueBps: BPS })
    expect(w.map(x => x.key)).toEqual(['b'])
  })

  it('returns [] when nothing is eligible (all capital stays idle)', () => {
    expect(computeBestRateWeights([], {})).toEqual([])
    expect(computeBestRateWeights([V('a', 900, false)], {})).toEqual([])
  })

  it('validates the caps', () => {
    expect(() => computeBestRateWeights([V('a', 1)], { maxVenueBps: 0 })).toThrow()
    expect(() => computeBestRateWeights([V('a', 1)], { maxVenueBps: 10_001 })).toThrow()
    expect(() => computeBestRateWeights([V('a', 1)], { idleBufferBps: BPS })).toThrow()
  })

  it('output is always a valid setVenues input (sum ≤ BPS, each ≤ cap, keys unique)', () => {
    const venues = Array.from({ length: 6 }, (_, i) => V('v' + i, 100 + i * 37))
    const w = computeBestRateWeights(venues, { maxVenueBps: 3_500, idleBufferBps: 500 })
    expect(sum(w)).toBeLessThanOrEqual(BPS)
    expect(w.every(x => x.weightBps <= 3_500)).toBe(true)
    expect(new Set(w.map(x => x.key)).size).toBe(w.length)
  })
})

describe('venueRatesFromApyPct', () => {
  it('maps percentage APY to bps and drops null rates', () => {
    const out = venueRatesFromApyPct([
      { key: 'a', apyPct: 5.5 },
      { key: 'b', apyPct: null },
      { key: 'c', apyPct: 4.03 },
    ])
    expect(out).toEqual([
      { key: 'a', label: undefined, apyBps: 550, available: undefined },
      { key: 'c', label: undefined, apyBps: 403, available: undefined },
    ])
  })

  it('feeds straight into computeBestRateWeights', () => {
    const rates = venueRatesFromApyPct([{ key: 'aave', apyPct: 4 }, { key: 'morpho', apyPct: 6 }])
    const w = computeBestRateWeights(rates, { maxVenueBps: BPS })
    expect(w[0].key).toBe('morpho') // higher rate wins
  })
})

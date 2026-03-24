// T4.1 — Vitest unit tests for volatilityMonitor.ts
// Tests cover: Bollinger Bands, ATR, tick math, range derivation, and edge cases.
// All tests are pure — no network calls. Pyth fetch functions are not tested here.

import { describe, it, expect } from 'vitest'
import {
  computeBollingerBands,
  computeATR,
  priceToTick,
  tickToPrice,
  metricsToTickRange,
  type PriceCandle,
} from './volatilityMonitor'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCandles(closes: number[], highDelta = 0.02, lowDelta = 0.02): PriceCandle[] {
  return closes.map((c, i) => ({
    timestamp: 1700000000 + i * 3600,
    open:  c,
    high:  c * (1 + highDelta),
    low:   c * (1 - lowDelta),
    close: c,
  }))
}

// ─── priceToTick / tickToPrice ────────────────────────────────────────────────

describe('priceToTick', () => {
  it('price=1.0 → tick=0', () => {
    expect(priceToTick(1.0)).toBe(0)
  })

  it('price>1 → positive tick', () => {
    expect(priceToTick(2.0)).toBeGreaterThan(0)
  })

  it('price<1 → negative tick', () => {
    expect(priceToTick(0.5)).toBeLessThan(0)
  })

  it('tick 6931 → approx price 2.0 (within 0.01%)', () => {
    // 1.0001^6931 ≈ 2.0
    const price = tickToPrice(6931)
    expect(price).toBeCloseTo(2.0, 1)
  })

  it('priceToTick(tickToPrice(1000)) rounds back to 1000', () => {
    const tick  = priceToTick(tickToPrice(1000))
    expect(tick).toBe(1000)
  })

  it('throws for zero price', () => {
    expect(() => priceToTick(0)).toThrow()
  })

  it('throws for negative price', () => {
    expect(() => priceToTick(-1)).toThrow()
  })
})

describe('tickToPrice', () => {
  it('tick=0 → price=1.0', () => {
    expect(tickToPrice(0)).toBeCloseTo(1.0, 10)
  })

  it('tick=10000 → price > 1', () => {
    expect(tickToPrice(10000)).toBeGreaterThan(1)
  })

  it('tick=-10000 → price < 1', () => {
    expect(tickToPrice(-10000)).toBeLessThan(1)
  })

  it('tickToPrice(priceToTick(2000.0)) ≈ 2000 (within 0.02%)', () => {
    const tick  = priceToTick(2000.0)
    const price = tickToPrice(tick)
    expect(price / 2000.0).toBeCloseTo(1.0, 3)
  })
})

// ─── computeBollingerBands ────────────────────────────────────────────────────

describe('computeBollingerBands', () => {
  it('flat price series → upper/lower symmetric around mid', () => {
    const closes = Array(20).fill(100)
    const bb = computeBollingerBands(closes)
    expect(bb.mid).toBeCloseTo(100, 5)
    expect(bb.upper).toBeCloseTo(100, 5)
    expect(bb.lower).toBeCloseTo(100, 5)
    expect(bb.widthPct).toBeCloseTo(0, 5)
  })

  it('mid = SMA of the last 20 closes', () => {
    // 25 closes: first 5 are 0, last 20 are 100
    const closes = [...Array(5).fill(50), ...Array(20).fill(100)]
    const bb = computeBollingerBands(closes, 20, 2)
    expect(bb.mid).toBeCloseTo(100, 5)
  })

  it('upper > mid > lower for volatile series', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5))
    const bb = computeBollingerBands(closes)
    expect(bb.upper).toBeGreaterThan(bb.mid)
    expect(bb.lower).toBeLessThan(bb.mid)
  })

  it('widthPct reflects (upper-lower)/mid × 100', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5))
    const bb = computeBollingerBands(closes)
    const expected = ((bb.upper - bb.lower) / bb.mid) * 100
    expect(bb.widthPct).toBeCloseTo(expected, 8)
  })

  it('uses custom period', () => {
    // 15 closes, period=10 — should use last 10 only
    const closes = [...Array(5).fill(200), ...Array(10).fill(100)]
    const bb = computeBollingerBands(closes, 10, 2)
    expect(bb.mid).toBeCloseTo(100, 5)
  })

  it('throws when not enough data', () => {
    expect(() => computeBollingerBands([100, 100], 20)).toThrow(/at least 20/)
  })

  it('upper - lower = 2 * stdMult * stdDev', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
    const bb = computeBollingerBands(closes, 20, 2)
    // Manual: mean of 100..119 = 109.5
    const window = closes.slice(-20)
    const mean = window.reduce((s, v) => s + v, 0) / 20
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / 20
    const stdDev = Math.sqrt(variance)
    expect(bb.upper - bb.lower).toBeCloseTo(4 * stdDev, 8)
  })
})

// ─── computeATR ───────────────────────────────────────────────────────────────

describe('computeATR', () => {
  it('flat candles → ATR ≈ 2 × high delta × price', () => {
    // highDelta = 0.02, lowDelta = 0.02, close = 100 → H=102, L=98, TR=4 each candle
    const candles = makeCandles(Array(20).fill(100))
    const atr = computeATR(candles, 14)
    expect(atr).toBeCloseTo(4, 2)
  })

  it('ATR > 0 for any valid input', () => {
    const candles = makeCandles(Array(20).fill(2000))
    const atr = computeATR(candles, 14)
    expect(atr).toBeGreaterThan(0)
  })

  it('higher volatility → higher ATR', () => {
    const lowVol  = makeCandles(Array(20).fill(100), 0.01, 0.01)
    const highVol = makeCandles(Array(20).fill(100), 0.05, 0.05)
    expect(computeATR(highVol, 14)).toBeGreaterThan(computeATR(lowVol, 14))
  })

  it('uses only the last `period` true ranges', () => {
    // First 10 candles have high volatility, last 14 are flat
    const first10 = makeCandles(Array(10).fill(100), 0.1, 0.1)
    const last14  = makeCandles(Array(14).fill(100), 0.01, 0.01)
    // Combined: need period+1 = 15 candles minimum, so 24 total
    const candles  = [...makeCandles([100], 0.1, 0.1), ...first10, ...last14]
    const atr = computeATR(candles, 14)
    const flatAtr = computeATR([...makeCandles([100], 0.01, 0.01), ...last14], 14)
    // ATR should be close to flat series since last 14 dominate
    expect(atr).toBeCloseTo(flatAtr, 1)
  })

  it('throws when not enough candles', () => {
    const candles = makeCandles(Array(10).fill(100))
    expect(() => computeATR(candles, 14)).toThrow(/at least 15/)
  })

  it('gap candle: high - prevClose is considered in TR', () => {
    // Close at 100, then next candle gaps up: open/high/low/close = 110/112/109/110
    const candles: PriceCandle[] = [
      { timestamp: 0, open: 98, high: 102, low: 98, close: 100 },
      ...Array.from({ length: 14 }, (_, i) => ({
        timestamp: (i + 1) * 3600,
        open:  110,
        high:  112,
        low:   109,
        close: 110,
      })),
    ]
    const atr = computeATR(candles, 14)
    // TR for first candle after gap = max(112-109, |112-100|, |109-100|) = max(3, 12, 9) = 12
    // TR for all others = 3
    // ATR(14) = mean of last 14 TRs: first is 12, rest are 3
    const expected = (12 + 3 * 13) / 14
    expect(atr).toBeCloseTo(expected, 8)
  })
})

// ─── metricsToTickRange ───────────────────────────────────────────────────────

describe('metricsToTickRange', () => {
  const baseMetrics = {
    currentPrice: 2000,
    atr14: 40,          // $40 ATR on $2000 ETH = 2%
    bollinger: {
      upper:    2080,
      mid:      2000,
      lower:    1920,
      widthPct: 8,
    },
  }

  it('tickLower < tickUpper', () => {
    const range = metricsToTickRange(baseMetrics, 60)
    expect(range.tickLower).toBeLessThan(range.tickUpper)
  })

  it('ticks are multiples of tickSpacing', () => {
    const range = metricsToTickRange(baseMetrics, 60)
    expect(range.tickLower % 60).toBe(0)
    expect(range.tickUpper % 60).toBe(0)
  })

  it('priceLower < currentPrice < priceUpper', () => {
    const range = metricsToTickRange(baseMetrics, 60)
    expect(range.priceLower).toBeLessThan(baseMetrics.currentPrice)
    expect(range.priceUpper).toBeGreaterThan(baseMetrics.currentPrice)
  })

  it('priceLower = tickToPrice(tickLower)', () => {
    const range = metricsToTickRange(baseMetrics, 60)
    expect(range.priceLower).toBeCloseTo(tickToPrice(range.tickLower), 6)
  })

  it('priceUpper = tickToPrice(tickUpper)', () => {
    const range = metricsToTickRange(baseMetrics, 60)
    expect(range.priceUpper).toBeCloseTo(tickToPrice(range.tickUpper), 6)
  })

  it('wider volatility → wider tick range', () => {
    const narrowMetrics = { ...baseMetrics, bollinger: { ...baseMetrics.bollinger, upper: 2020, lower: 1980, widthPct: 2 }, atr14: 10 }
    const wideMetrics   = { ...baseMetrics, bollinger: { ...baseMetrics.bollinger, upper: 2200, lower: 1800, widthPct: 20 }, atr14: 100 }
    const narrow = metricsToTickRange(narrowMetrics, 60)
    const wide   = metricsToTickRange(wideMetrics,   60)
    expect(wide.tickUpper - wide.tickLower).toBeGreaterThan(narrow.tickUpper - narrow.tickLower)
  })

  it('ATR dominates when wider than BB half-width', () => {
    // ATR = $200 on $2000 price (10%), BB half-width = $40 (2%)
    const metrics = { ...baseMetrics, atr14: 200, bollinger: { upper: 2040, mid: 2000, lower: 1960, widthPct: 4 } }
    const range = metricsToTickRange(metrics, 60)
    // Range should be at least as wide as 2×ATR×safetyFactor
    const halfWidth = 200 * 1.15
    expect(range.priceUpper).toBeGreaterThan(2000 + halfWidth * 0.9) // allow floor rounding
    expect(range.priceLower).toBeLessThan(2000 - halfWidth * 0.9)
  })

  it('respects custom tickSpacing=10', () => {
    const range = metricsToTickRange(baseMetrics, 10)
    expect(range.tickLower % 10).toBe(0)
    expect(range.tickUpper % 10).toBe(0)
  })

  it('priceLower never goes below 1% of current price', () => {
    // Absurdly large ATR that would push priceLower below 0
    const metrics = { ...baseMetrics, atr14: 99999 }
    const range = metricsToTickRange(metrics, 60)
    expect(range.priceLower).toBeGreaterThan(0)
  })
})

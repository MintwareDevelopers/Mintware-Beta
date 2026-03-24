// T4.2 — Vitest unit tests for rangeProposer.ts
// Tests cover: assessRebalanceNeed decision logic (pure function, no I/O).
// signRangeProposal and proposeRebalance are not tested here (require env + DB).

import { describe, it, expect } from 'vitest'
import { assessRebalanceNeed, type CurrentTickRange, THRESHOLDS } from './rangeProposer'
import { priceToTick } from './volatilityMonitor'
import type { VolatilityMetrics } from './volatilityMonitor'

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Construct a minimal VolatilityMetrics for a given currentPrice + suggested range
function makeMetrics(
  currentPrice: number,
  suggestedTickLower: number,
  suggestedTickUpper: number,
  overrides: Partial<VolatilityMetrics> = {},
): VolatilityMetrics {
  return {
    feedId:       '0xabc',
    computedAt:   1700000000,
    windowHours:  168,
    candleCount:  168,
    atr14:        currentPrice * 0.02,
    atrPct:       2,
    bollinger: {
      upper:    currentPrice * 1.04,
      mid:      currentPrice,
      lower:    currentPrice * 0.96,
      widthPct: 8,
    },
    currentPrice,
    suggestedTicks: {
      tickLower:  suggestedTickLower,
      tickUpper:  suggestedTickUpper,
      priceLower: Math.pow(1.0001, suggestedTickLower),
      priceUpper: Math.pow(1.0001, suggestedTickUpper),
    },
    confidence: 'high',
    ...overrides,
  }
}

// Build a current tick range centered on `price` with `halfWidthTicks` on each side
function centeredRange(price: number, halfWidthTicks: number): CurrentTickRange {
  const mid = priceToTick(price)
  return { tickLower: mid - halfWidthTicks, tickUpper: mid + halfWidthTicks }
}

// ─── assessRebalanceNeed: forced ─────────────────────────────────────────────

describe('assessRebalanceNeed — forced', () => {
  it('returns reason=scheduled and shouldRebalance=true when forced=true', () => {
    const current = centeredRange(2000, 1000)
    const metrics = makeMetrics(2000, current.tickLower, current.tickUpper)
    const result  = assessRebalanceNeed(current, metrics, true)
    expect(result.shouldRebalance).toBe(true)
    expect(result.reason).toBe('scheduled')
  })

  it('returns the metrics summary in the decision', () => {
    const current = centeredRange(2000, 1000)
    const metrics = makeMetrics(2000, current.tickLower, current.tickUpper)
    const result  = assessRebalanceNeed(current, metrics, true)
    expect(result.metrics.currentPrice).toBe(2000)
    expect(result.currentRange).toEqual(current)
  })
})

// ─── assessRebalanceNeed: no rebalance ───────────────────────────────────────

describe('assessRebalanceNeed — no rebalance', () => {
  it('returns none when price is centered and range matches suggested', () => {
    const current = centeredRange(2000, 1000)
    const metrics = makeMetrics(2000, current.tickLower, current.tickUpper)
    const result  = assessRebalanceNeed(current, metrics)
    expect(result.shouldRebalance).toBe(false)
    expect(result.reason).toBe('none')
  })

  it('does not trigger when price is inside range but slightly off-center (< drift threshold)', () => {
    // 5% drift on a range centered at 2000 — below DRIFT_PCT threshold of 8%
    const current = centeredRange(2000, 2000)
    // Shift metrics price slightly without hitting drift threshold
    const metrics = makeMetrics(2100, current.tickLower, current.tickUpper)
    const result  = assessRebalanceNeed(current, metrics)
    // 2100 is inside the wide range and drift is ~5% — below threshold
    expect(result.reason).toBe('none')
  })
})

// ─── assessRebalanceNeed: price_out_of_range ─────────────────────────────────

describe('assessRebalanceNeed — price_out_of_range', () => {
  it('triggers when price is below tickLower', () => {
    // Current range: 1900–2100. Price: 1800 (below)
    const current = { tickLower: priceToTick(1900), tickUpper: priceToTick(2100) }
    const metrics = makeMetrics(1800, current.tickLower - 500, current.tickUpper - 500)
    const result  = assessRebalanceNeed(current, metrics)
    expect(result.shouldRebalance).toBe(true)
    expect(result.reason).toBe('price_out_of_range')
  })

  it('triggers when price is above tickUpper', () => {
    // Current range: 1900–2100. Price: 2300 (above)
    const current = { tickLower: priceToTick(1900), tickUpper: priceToTick(2100) }
    const metrics = makeMetrics(2300, current.tickLower + 500, current.tickUpper + 500)
    const result  = assessRebalanceNeed(current, metrics)
    expect(result.shouldRebalance).toBe(true)
    expect(result.reason).toBe('price_out_of_range')
  })

  it('does NOT trigger when price is exactly at tickLower boundary (inside)', () => {
    const lower = priceToTick(1900)
    const upper = priceToTick(2100)
    const priceLower = Math.pow(1.0001, lower)
    const current = { tickLower: lower, tickUpper: upper }
    // Price exactly at priceLower — still inside range
    const metrics = makeMetrics(priceLower * 1.001, lower - 200, upper - 200)
    const result  = assessRebalanceNeed(current, metrics)
    expect(result.reason).not.toBe('price_out_of_range')
  })
})

// ─── assessRebalanceNeed: range_drifted ──────────────────────────────────────

describe('assessRebalanceNeed — range_drifted', () => {
  it('triggers when current midpoint is > DRIFT_PCT% away from price', () => {
    // Range centered at $2000. Price has moved to $2200 (10% drift > 8% threshold)
    const current = centeredRange(2000, 3000)   // wide range so price is still inside
    const metrics = makeMetrics(2200, current.tickLower, current.tickUpper)
    // Override midPrice: range centered at 2000, price at 2200 → 9.1% drift
    const result  = assessRebalanceNeed(current, metrics)
    expect(result.shouldRebalance).toBe(true)
    expect(result.reason).toBe('range_drifted')
  })

  it('does NOT trigger when drift is just below threshold', () => {
    // Range centered at 2000, price at 2150 → 7.1% drift < 8%
    const current = centeredRange(2000, 5000)
    const metrics = makeMetrics(2150, current.tickLower, current.tickUpper)
    const result  = assessRebalanceNeed(current, metrics)
    expect(result.reason).toBe('none')
  })
})

// ─── assessRebalanceNeed: range_too_narrow ────────────────────────────────────

describe('assessRebalanceNeed — range_too_narrow', () => {
  it('triggers when proposed range is significantly wider than current', () => {
    // Current: 500 ticks wide. Proposed: 2000 ticks wide (4×, way beyond NARROW_RATIO)
    const mid = priceToTick(2000)
    const current  = { tickLower: mid - 250, tickUpper: mid + 250 }   // 500 wide
    const proposed = { tickLower: mid - 1000, tickUpper: mid + 1000 } // 2000 wide
    const metrics  = makeMetrics(2000, proposed.tickLower, proposed.tickUpper)
    const result   = assessRebalanceNeed(current, metrics)
    expect(result.shouldRebalance).toBe(true)
    expect(result.reason).toBe('range_too_narrow')
  })

  it('does NOT trigger when proposed is only slightly wider', () => {
    // Current: 1000 ticks. Proposed: 1200 ticks (1.2× — below 1/NARROW_RATIO ≈ 1.67×)
    const mid = priceToTick(2000)
    const current  = { tickLower: mid - 500, tickUpper: mid + 500 }
    const proposed = { tickLower: mid - 600, tickUpper: mid + 600 }
    const metrics  = makeMetrics(2000, proposed.tickLower, proposed.tickUpper)
    const result   = assessRebalanceNeed(current, metrics)
    expect(result.reason).toBe('none')
  })
})

// ─── assessRebalanceNeed: range_too_wide ─────────────────────────────────────

describe('assessRebalanceNeed — range_too_wide', () => {
  it('triggers when proposed range is significantly narrower than current', () => {
    // Current: 6000 ticks. Proposed: 500 ticks (12×, beyond WIDE_RATIO of 2.5×)
    const mid = priceToTick(2000)
    const current  = { tickLower: mid - 3000, tickUpper: mid + 3000 } // 6000 wide
    const proposed = { tickLower: mid - 250,  tickUpper: mid + 250  } // 500 wide
    const metrics  = makeMetrics(2000, proposed.tickLower, proposed.tickUpper)
    const result   = assessRebalanceNeed(current, metrics)
    expect(result.shouldRebalance).toBe(true)
    expect(result.reason).toBe('range_too_wide')
  })

  it('does NOT trigger when proposed is only moderately narrower', () => {
    // Current: 2000 ticks. Proposed: 1200 ticks (1.67× — below WIDE_RATIO of 2.5×)
    const mid = priceToTick(2000)
    const current  = { tickLower: mid - 1000, tickUpper: mid + 1000 }
    const proposed = { tickLower: mid - 600,  tickUpper: mid + 600  }
    const metrics  = makeMetrics(2000, proposed.tickLower, proposed.tickUpper)
    const result   = assessRebalanceNeed(current, metrics)
    expect(result.reason).toBe('none')
  })
})

// ─── Priority ordering ────────────────────────────────────────────────────────

describe('assessRebalanceNeed — priority', () => {
  it('price_out_of_range takes priority over range_too_narrow', () => {
    // Price below range AND proposed is much wider
    const mid = priceToTick(2000)
    const current  = { tickLower: mid + 500, tickUpper: mid + 2000 } // price below range
    const proposed = { tickLower: mid - 2000, tickUpper: mid + 2000 }
    // currentPrice = 2000, priceLower = 1.0001^(mid+500) > 2000 → price out of range
    const metrics  = makeMetrics(2000, proposed.tickLower, proposed.tickUpper)
    const result   = assessRebalanceNeed(current, metrics)
    expect(result.reason).toBe('price_out_of_range')
  })

  it('returns proposedTicks from metrics.suggestedTicks', () => {
    const current = centeredRange(2000, 1000)
    const metrics = makeMetrics(1500, current.tickLower - 1000, current.tickUpper - 1000)
    const result  = assessRebalanceNeed(current, metrics)
    expect(result.proposedTicks).toEqual(metrics.suggestedTicks)
  })
})

// ─── THRESHOLDS export ────────────────────────────────────────────────────────

describe('THRESHOLDS', () => {
  it('exports the expected keys', () => {
    expect(THRESHOLDS).toHaveProperty('DRIFT_PCT')
    expect(THRESHOLDS).toHaveProperty('NARROW_RATIO')
    expect(THRESHOLDS).toHaveProperty('WIDE_RATIO')
    expect(THRESHOLDS.DRIFT_PCT).toBeGreaterThan(0)
  })
})

import { describe, it, expect } from 'vitest'
import { calcBuyerReward, calcReferrerReward } from '@/lib/rewards/calc'

describe('calcBuyerReward', () => {
  it('should calculate reward at 0.5% correctly', () => {
    expect(calcBuyerReward(100, 0.5)).toBe(0.5)
  })

  it('should calculate reward at 1.0% correctly', () => {
    expect(calcBuyerReward(200, 1.0)).toBe(2)
  })

  it('should calculate reward at 5.0% correctly', () => {
    expect(calcBuyerReward(50, 5.0)).toBe(2.5)
  })

  it('should return 0 when percentage is 0', () => {
    expect(calcBuyerReward(1000, 0)).toBe(0)
  })

  it('should return 0 when trade amount is 0', () => {
    expect(calcBuyerReward(0, 1.5)).toBe(0)
  })

  it('should return 0 when both trade amount and percentage are 0', () => {
    expect(calcBuyerReward(0, 0)).toBe(0)
  })

  it('should handle fractional cent amounts on small trades', () => {
    // $1 trade at 0.5% = $0.005
    expect(calcBuyerReward(1, 0.5)).toBeCloseTo(0.005, 10)
  })

  it('should handle very small trade amounts', () => {
    // $0.01 at 1% = $0.0001
    expect(calcBuyerReward(0.01, 1)).toBeCloseTo(0.0001, 10)
  })

  it('should scale correctly for large trade amounts', () => {
    expect(calcBuyerReward(10_000, 2)).toBe(200)
  })

  it('should handle non-integer percentages accurately', () => {
    expect(calcBuyerReward(300, 1.5)).toBe(4.5)
  })
})

describe('calcReferrerReward', () => {
  it('should calculate reward at 0.5% correctly', () => {
    expect(calcReferrerReward(100, 0.5)).toBe(0.5)
  })

  it('should calculate reward at 1.0% correctly', () => {
    expect(calcReferrerReward(200, 1.0)).toBe(2)
  })

  it('should calculate reward at 5.0% correctly', () => {
    expect(calcReferrerReward(50, 5.0)).toBe(2.5)
  })

  it('should return 0 when percentage is 0', () => {
    expect(calcReferrerReward(1000, 0)).toBe(0)
  })

  it('should return 0 when trade amount is 0', () => {
    expect(calcReferrerReward(0, 1.5)).toBe(0)
  })

  it('should return 0 when both trade amount and percentage are 0', () => {
    expect(calcReferrerReward(0, 0)).toBe(0)
  })

  it('should handle fractional cent amounts on small trades', () => {
    // $1 trade at 0.5% = $0.005
    expect(calcReferrerReward(1, 0.5)).toBeCloseTo(0.005, 10)
  })

  it('should handle very small trade amounts', () => {
    // $0.01 at 1% = $0.0001
    expect(calcReferrerReward(0.01, 1)).toBeCloseTo(0.0001, 10)
  })

  it('should scale correctly for large trade amounts', () => {
    expect(calcReferrerReward(10_000, 2)).toBe(200)
  })

  it('should handle non-integer percentages accurately', () => {
    expect(calcReferrerReward(300, 1.5)).toBe(4.5)
  })

  it('should produce the same result as calcBuyerReward given identical inputs', () => {
    // Both functions are identical in formula — referrer and buyer rewards
    // use the same calculation, just driven by different configured percentages.
    expect(calcReferrerReward(500, 2.5)).toBe(calcBuyerReward(500, 2.5))
  })
})

import { describe, it, expect } from 'vitest'
import { tierForPercentile, policyForPercentile, pricedForTier } from './pricing'

describe('reputation-gated pricing', () => {
  it('buckets percentiles the same way as the rewards multipliers', () => {
    expect(tierForPercentile(0)).toBe('unknown')
    expect(tierForPercentile(33)).toBe('unknown')
    expect(tierForPercentile(34)).toBe('standard')
    expect(tierForPercentile(66)).toBe('standard')
    expect(tierForPercentile(67)).toBe('trusted')
    expect(tierForPercentile(100)).toBe('trusted')
  })

  it('clamps out-of-range / NaN percentiles to the unknown tier', () => {
    expect(tierForPercentile(-5)).toBe('unknown')
    expect(tierForPercentile(999)).toBe('trusted')
    expect(tierForPercentile(Number.NaN)).toBe('unknown')
  })

  it('unproven payers get tighter limits + a surcharge + conservative headroom', () => {
    const unknown = policyForPercentile(10)
    const trusted = policyForPercentile(90)
    expect(unknown.rateLimitPerMin).toBeLessThan(trusted.rateLimitPerMin)
    expect(unknown.priceMultiplier).toBeGreaterThan(trusted.priceMultiplier)
    expect(unknown.navHeadroomFraction).toBeLessThan(trusted.navHeadroomFraction)
    expect(trusted.navHeadroomFraction).toBe(1.0)
  })

  it('prices by tier, rounding up so the seller never underprices', () => {
    const base = 1_000_000n // 1 USDC
    expect(pricedForTier(base, policyForPercentile(90))).toBe(900_000n) // 0.9x discount
    expect(pricedForTier(base, policyForPercentile(50))).toBe(1_000_000n) // 1.0x
    expect(pricedForTier(base, policyForPercentile(10))).toBe(1_100_000n) // 1.1x surcharge
    // ceil rounding: 999999 * 1.1 = 1099998.9 → 1099999
    expect(pricedForTier(999_999n, policyForPercentile(10))).toBe(1_099_999n)
  })
})

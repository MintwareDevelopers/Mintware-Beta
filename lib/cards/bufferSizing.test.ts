import { describe, it, expect } from 'vitest'
import {
  probit,
  zMilliForServiceLevel,
  newsvendorCriticalRatioBps,
  serviceLevelForCostsBps,
  safetyStockAtomic,
  bufferTargetAtomic,
  BUFFER_PROFILE_DEFAULTS,
  type BufferSizingParams,
} from './bufferSizing'

const USDC = (n: number): bigint => BigInt(Math.round(n * 1_000_000)) // dollars → atomic 6dp

// A baseline "business" card: $200 expected over a 60s refill, $80 daily spend stdev, 99% service.
const BASE: BufferSizingParams = {
  meanDemandLeadTimeAtomic: USDC(200),
  demandStdevAtomic: USDC(80),
  sigmaPeriodSecs: 86_400,
  leadTimeSecs: 60,
  serviceLevelBps: 9900,
}

describe('probit — inverse normal CDF', () => {
  it('matches known quantiles', () => {
    expect(probit(0.5)).toBeCloseTo(0, 6)
    expect(probit(0.975)).toBeCloseTo(1.959964, 4) // the classic 1.96
    expect(probit(0.99)).toBeCloseTo(2.326348, 4)
    expect(probit(0.95)).toBeCloseTo(1.644854, 4)
  })
  it('is symmetric and monotonic increasing', () => {
    expect(probit(0.1)).toBeCloseTo(-probit(0.9), 6)
    expect(probit(0.6)).toBeGreaterThan(probit(0.4))
  })
  it('stays finite at the extremes (clamped)', () => {
    expect(Number.isFinite(probit(0))).toBe(true)
    expect(Number.isFinite(probit(1))).toBe(true)
    expect(probit(0)).toBeLessThan(0)
    expect(probit(1)).toBeGreaterThan(0)
  })
})

describe('zMilliForServiceLevel', () => {
  it('gives the textbook z-scores', () => {
    expect(zMilliForServiceLevel(9500)).toBe(1645) // 1.645
    expect(zMilliForServiceLevel(9900)).toBe(2326) // 2.326
    expect(zMilliForServiceLevel(9990)).toBe(3090) // 3.090 (99.9%)
  })
  it('clamps to 0 at/below the median (a buffer never sizes below its mean base)', () => {
    expect(zMilliForServiceLevel(5000)).toBe(0)
    expect(zMilliForServiceLevel(2000)).toBe(0)
    expect(zMilliForServiceLevel(0)).toBe(0)
  })
  it('is monotone non-decreasing in service level', () => {
    let prev = -1
    for (const sl of [5000, 6000, 7500, 9000, 9500, 9900, 9990]) {
      const z = zMilliForServiceLevel(sl)
      expect(z).toBeGreaterThanOrEqual(prev)
      prev = z
    }
  })
})

describe('newsvendor critical ratio', () => {
  it('Cu/(Cu+Co) in bps', () => {
    expect(newsvendorCriticalRatioBps({ underageCost: 1, overageCost: 1 })).toBe(5000)
    expect(newsvendorCriticalRatioBps({ underageCost: 9, overageCost: 1 })).toBe(9000)
    expect(newsvendorCriticalRatioBps({ underageCost: 99, overageCost: 1 })).toBe(9900)
  })
  it('degenerate costs → 0 (never NaN)', () => {
    expect(newsvendorCriticalRatioBps({ underageCost: 0, overageCost: 0 })).toBe(0)
    expect(newsvendorCriticalRatioBps({ underageCost: -5, overageCost: -5 })).toBe(0)
  })
  it('serviceLevelForCosts is the same ratio (the two framings unify)', () => {
    expect(serviceLevelForCostsBps({ underageCost: 99, overageCost: 1 })).toBe(9900)
  })
})

describe('safetyStockAtomic — z·σ·√(T/period)', () => {
  it('scales σ by √(T/period) and rounds UP', () => {
    // z(99%)=2.326, σ=$80, √(60/86400)=0.02635 → 2.326×80×0.02635 ≈ $4.904 → ceil to atomic
    const ss = safetyStockAtomic(BASE)
    expect(ss).toBeGreaterThan(USDC(4.9))
    expect(ss).toBeLessThan(USDC(5.0))
  })
  it('grows with the lead time (√T is the biggest lever, §3)', () => {
    const fast = safetyStockAtomic({ ...BASE, leadTimeSecs: 30 })
    const slow = safetyStockAtomic({ ...BASE, leadTimeSecs: 300 })
    expect(slow).toBeGreaterThan(fast)
    // √10 ≈ 3.16× more σ for 10× the lead time
    expect(Number(slow) / Number(fast)).toBeGreaterThan(3)
    expect(Number(slow) / Number(fast)).toBeLessThan(3.3)
  })
  it('grows with service level and with σ', () => {
    expect(safetyStockAtomic({ ...BASE, serviceLevelBps: 9990 })).toBeGreaterThan(safetyStockAtomic(BASE))
    expect(safetyStockAtomic({ ...BASE, demandStdevAtomic: USDC(160) })).toBeGreaterThan(safetyStockAtomic(BASE))
  })
  it('is zero when there is no variance, no lead time, or z≤0', () => {
    expect(safetyStockAtomic({ ...BASE, demandStdevAtomic: 0n })).toBe(0n)
    expect(safetyStockAtomic({ ...BASE, leadTimeSecs: 0 })).toBe(0n)
    expect(safetyStockAtomic({ ...BASE, sigmaPeriodSecs: 0 })).toBe(0n)
    expect(safetyStockAtomic({ ...BASE, serviceLevelBps: 5000 })).toBe(0n)
  })
})

describe('bufferTargetAtomic — μ_L + safety stock, clamped', () => {
  it('is the mean lead-time demand plus the safety stock', () => {
    const ss = safetyStockAtomic(BASE)
    expect(bufferTargetAtomic(BASE)).toBe(BASE.meanDemandLeadTimeAtomic + ss)
  })
  it('never exceeds the protocol max (the §3 Co exposure cap)', () => {
    expect(bufferTargetAtomic({ ...BASE, maxBufferAtomic: USDC(50) })).toBe(USDC(50))
  })
  it('never drops below the usable floor', () => {
    const tiny: BufferSizingParams = { ...BASE, meanDemandLeadTimeAtomic: USDC(1), demandStdevAtomic: USDC(1), minBufferAtomic: USDC(25) }
    expect(bufferTargetAtomic(tiny)).toBe(USDC(25))
  })
  it('floor wins over ceiling when they cross', () => {
    expect(bufferTargetAtomic({ ...BASE, minBufferAtomic: USDC(100), maxBufferAtomic: USDC(40) })).toBe(USDC(100))
  })
  it('a bigger refill lead time forces a bigger target', () => {
    const fast = bufferTargetAtomic({ ...BASE, leadTimeSecs: 30 })
    const slow = bufferTargetAtomic({ ...BASE, leadTimeSecs: 600 })
    expect(slow).toBeGreaterThan(fast)
  })
})

describe('profile defaults', () => {
  it('business runs a tighter service level than coffee', () => {
    expect(BUFFER_PROFILE_DEFAULTS.business.serviceLevelBps).toBeGreaterThan(BUFFER_PROFILE_DEFAULTS.coffee.serviceLevelBps)
  })
})

import { describe, it, expect } from 'vitest'
import { appraisalX96FromNav } from './appraisal'

const Q96 = 1n << 96n
const e = (d: number) => 10n ** BigInt(d)

describe('appraisalX96FromNav', () => {
  it('par 1:1 with equal decimals → exactly 2^96 (matches the demo INIT_SQRT_PRICE 1:1)', () => {
    // vRWA 18-dec, USDC 18-dec (the demo MockERC20), NAV = 1.0 → convertToAssets(1e18) = 1e18
    expect(appraisalX96FromNav({ assetsPerWholeShareRaw: e(18), vrwaDecimals: 18, vrwaIsCurrency0: true })).toBe(Q96)
    // ordering is irrelevant at par (reciprocal of 1 is 1)
    expect(appraisalX96FromNav({ assetsPerWholeShareRaw: e(18), vrwaDecimals: 18, vrwaIsCurrency0: false })).toBe(Q96)
  })

  it('par 1:1 with real decimals (vRWA 18, USDC 6) — vRWA is currency0', () => {
    // convertToAssets(1e18 shares) = 1e6 raw USDC (1.00 USDC). price = 1e6/1e18 raw × 2^96
    const got = appraisalX96FromNav({ assetsPerWholeShareRaw: e(6), vrwaDecimals: 18, vrwaIsCurrency0: true })
    expect(got).toBe((e(6) * Q96) / e(18)) // = 2^96 / 1e12
  })

  it('NAV premium 1.05 stays within a ±15% core band (token0 = vRWA)', () => {
    const par = appraisalX96FromNav({ assetsPerWholeShareRaw: e(18), vrwaDecimals: 18, vrwaIsCurrency0: true })
    const nav105 = appraisalX96FromNav({ assetsPerWholeShareRaw: (e(18) * 105n) / 100n, vrwaDecimals: 18, vrwaIsCurrency0: true })
    expect(nav105).toBe((par * 105n) / 100n)
    // deviation vs par ≈ 500 bps (±1 for integer flooring) → inside a 1500 bps core band
    const devBps = ((nav105 - par) * 10_000n) / par
    expect(devBps).toBeGreaterThanOrEqual(499n)
    expect(devBps).toBeLessThanOrEqual(500n)
  })

  it('reversed ordering (USDC currency0) is the reciprocal in Q96', () => {
    const a = (e(18) * 105n) / 100n // NAV 1.05, equal decimals
    const v0 = appraisalX96FromNav({ assetsPerWholeShareRaw: a, vrwaDecimals: 18, vrwaIsCurrency0: true })
    const u0 = appraisalX96FromNav({ assetsPerWholeShareRaw: a, vrwaDecimals: 18, vrwaIsCurrency0: false })
    // v0 = 1.05·2^96 ; u0 = (1/1.05)·2^96 ; product ≈ 2^192 (within integer rounding)
    const prod = (v0 * u0) / Q96
    const diff = prod > Q96 ? prod - Q96 : Q96 - prod
    expect(diff).toBeLessThan(Q96 / 1_000_000n) // reciprocal to ~1e-6
  })

  it('rejects non-positive NAV', () => {
    expect(() => appraisalX96FromNav({ assetsPerWholeShareRaw: 0n, vrwaDecimals: 18, vrwaIsCurrency0: true })).toThrow()
    expect(() => appraisalX96FromNav({ assetsPerWholeShareRaw: -1n, vrwaDecimals: 18, vrwaIsCurrency0: true })).toThrow()
  })

  it('rejects nonsense decimals', () => {
    expect(() => appraisalX96FromNav({ assetsPerWholeShareRaw: e(18), vrwaDecimals: 40, vrwaIsCurrency0: true })).toThrow()
  })
})

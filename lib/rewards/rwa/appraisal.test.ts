import { describe, it, expect } from 'vitest'
import { appraisalX96FromNav } from './appraisal'

const Q96 = 1n << 96n
const e = (d: number) => 10n ** BigInt(d)

describe('appraisalX96FromNav', () => {
  it('par (assets == shares) → exactly 2^96, at any decimals (matches demo INIT_SQRT_PRICE)', () => {
    // OZ ERC-4626 shares default to the underlying (USDC) decimals, so at par
    // convertToAssets(10^d) == 10^d regardless of d.
    for (const d of [6, 18]) {
      expect(appraisalX96FromNav({ assetsRaw: e(d), sharesRaw: e(d), vrwaIsCurrency0: true })).toBe(Q96)
      // ordering is irrelevant at par (reciprocal of 1 is 1)
      expect(appraisalX96FromNav({ assetsRaw: e(d), sharesRaw: e(d), vrwaIsCurrency0: false })).toBe(Q96)
    }
  })

  it('does NOT depend on vRWA declared decimals — only on the assets/shares ratio', () => {
    // Same par ratio, wildly different absolute magnitudes → same appraisal.
    const a = appraisalX96FromNav({ assetsRaw: e(6), sharesRaw: e(6), vrwaIsCurrency0: true })
    const b = appraisalX96FromNav({ assetsRaw: e(18), sharesRaw: e(18), vrwaIsCurrency0: true })
    expect(a).toBe(b)
    expect(a).toBe(Q96)
  })

  it('NAV premium 1.05 (assets > shares) stays within a ±15% core band (token0 = vRWA)', () => {
    const shares = e(6)
    const par = appraisalX96FromNav({ assetsRaw: shares, sharesRaw: shares, vrwaIsCurrency0: true })
    const nav105 = appraisalX96FromNav({ assetsRaw: (shares * 105n) / 100n, sharesRaw: shares, vrwaIsCurrency0: true })
    const devBps = ((nav105 - par) * 10_000n) / par
    expect(devBps).toBeGreaterThanOrEqual(499n) // ~500 bps (±1 for integer flooring)
    expect(devBps).toBeLessThanOrEqual(500n)
  })

  it('reversed ordering (USDC currency0) is the reciprocal in Q96', () => {
    const shares = e(18)
    const assets = (shares * 105n) / 100n // NAV 1.05
    const v0 = appraisalX96FromNav({ assetsRaw: assets, sharesRaw: shares, vrwaIsCurrency0: true })
    const u0 = appraisalX96FromNav({ assetsRaw: assets, sharesRaw: shares, vrwaIsCurrency0: false })
    const prod = (v0 * u0) / Q96
    const diff = prod > Q96 ? prod - Q96 : Q96 - prod
    expect(diff).toBeLessThan(Q96 / 1_000_000n) // reciprocal to ~1e-6
  })

  it('rejects non-positive assets or shares', () => {
    expect(() => appraisalX96FromNav({ assetsRaw: 0n, sharesRaw: e(18), vrwaIsCurrency0: true })).toThrow()
    expect(() => appraisalX96FromNav({ assetsRaw: e(18), sharesRaw: 0n, vrwaIsCurrency0: true })).toThrow()
    expect(() => appraisalX96FromNav({ assetsRaw: -1n, sharesRaw: e(18), vrwaIsCurrency0: true })).toThrow()
  })
})

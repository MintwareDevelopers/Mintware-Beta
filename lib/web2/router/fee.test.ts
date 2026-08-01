import { describe, it, expect } from 'vitest'
import {
  applyRouterFee,
  normalizeRouterFeeBps,
  ROUTER_FEE_BPS_DEFAULT,
  ROUTER_FEE_BPS_CAP,
} from './fee'

describe('normalizeRouterFeeBps', () => {
  it('returns the default for undefined / null / NaN', () => {
    expect(normalizeRouterFeeBps(undefined)).toBe(ROUTER_FEE_BPS_DEFAULT)
    expect(normalizeRouterFeeBps(null)).toBe(ROUTER_FEE_BPS_DEFAULT)
    expect(normalizeRouterFeeBps(NaN)).toBe(ROUTER_FEE_BPS_DEFAULT)
    expect(normalizeRouterFeeBps(Infinity)).toBe(ROUTER_FEE_BPS_DEFAULT)
  })

  it('clamps negatives to 0', () => {
    expect(normalizeRouterFeeBps(-1)).toBe(0)
    expect(normalizeRouterFeeBps(-9999)).toBe(0)
  })

  it('clamps above the hard cap', () => {
    expect(normalizeRouterFeeBps(ROUTER_FEE_BPS_CAP + 1)).toBe(ROUTER_FEE_BPS_CAP)
    expect(normalizeRouterFeeBps(10_000)).toBe(ROUTER_FEE_BPS_CAP)
  })

  it('floors fractional bps', () => {
    expect(normalizeRouterFeeBps(30.9)).toBe(30)
    expect(normalizeRouterFeeBps(0.9)).toBe(0)
  })

  it('passes valid values through', () => {
    expect(normalizeRouterFeeBps(50)).toBe(50)
    expect(normalizeRouterFeeBps(0)).toBe(0)
    expect(normalizeRouterFeeBps(ROUTER_FEE_BPS_CAP)).toBe(ROUTER_FEE_BPS_CAP)
  })
})

describe('applyRouterFee', () => {
  it('skims 0.5% by default parity rate', () => {
    const { net, fee } = applyRouterFee(1_000_000n, 50)
    expect(fee).toBe(5_000n)
    expect(net).toBe(995_000n)
    expect(net + fee).toBe(1_000_000n)
  })

  it('returns zero split for non-positive gross', () => {
    expect(applyRouterFee(0n, 50)).toEqual({ net: 0n, fee: 0n })
    expect(applyRouterFee(-100n, 50)).toEqual({ net: 0n, fee: 0n })
  })

  it('charges nothing at 0 bps', () => {
    expect(applyRouterFee(1_000_000n, 0)).toEqual({ net: 1_000_000n, fee: 0n })
  })

  it('clamps an over-cap fee before charging', () => {
    // 200 bps requested → clamped to cap (100 = 1%)
    const { net, fee } = applyRouterFee(1_000_000n, 200)
    expect(fee).toBe(10_000n) // 1% of 1,000,000
    expect(net).toBe(990_000n)
  })

  it('treats a negative fee as 0', () => {
    expect(applyRouterFee(1_000_000n, -5)).toEqual({ net: 1_000_000n, fee: 0n })
  })

  it('rounds dust in the user\'s favor (floor on the fee)', () => {
    // 1 unit at 0.5% → fee floors to 0, user keeps the whole unit
    expect(applyRouterFee(1n, 50)).toEqual({ net: 1n, fee: 0n })
    // 199 units at 0.5% → fee floors to 0 (0.995), user keeps all
    expect(applyRouterFee(199n, 50)).toEqual({ net: 199n, fee: 0n })
    // 200 units at 0.5% → fee = 1 exactly
    expect(applyRouterFee(200n, 50)).toEqual({ net: 199n, fee: 1n })
  })

  it('is exact for huge amounts (no float drift)', () => {
    const gross = 10n ** 30n
    const { net, fee } = applyRouterFee(gross, 50)
    expect(fee).toBe((gross * 50n) / 10_000n)
    expect(net + fee).toBe(gross)
  })
})

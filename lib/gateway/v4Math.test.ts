import { describe, it, expect } from 'vitest'
import {
  Q96, MIN_TICK, MAX_TICK, MIN_SQRT_PRICE, MAX_SQRT_PRICE,
  getSqrtPriceAtTick, getLiquidityForAmounts, getAmountsForLiquidity, isInRange, applyToleranceBps,
  quoteToPairedAtSpot,
} from './v4Math'

// Relative error of a bigint vs a float reference.
const relErr = (got: bigint, ref: number) => Math.abs(Number(got) - ref) / ref

describe('getSqrtPriceAtTick (TickMath mirror)', () => {
  it('tick 0 is exactly 2^96', () => {
    expect(getSqrtPriceAtTick(0)).toBe(Q96)
  })
  it('MIN/MAX ticks hit the v4-core constants exactly', () => {
    expect(getSqrtPriceAtTick(MIN_TICK)).toBe(MIN_SQRT_PRICE)
    expect(getSqrtPriceAtTick(MAX_TICK)).toBe(MAX_SQRT_PRICE)
  })
  it('matches sqrt(1.0001^tick)·2^96 to <1e-9 relative across the range', () => {
    for (const t of [1, -1, 60, -60, 1000, -1000, 23027, -23027, 200_000, -200_000, 887_000, -887_000]) {
      const ref = Math.sqrt(1.0001 ** t) * 2 ** 96
      expect(relErr(getSqrtPriceAtTick(t), ref)).toBeLessThan(1e-9)
    }
  })
  it('is monotonic', () => {
    let prev = getSqrtPriceAtTick(-5000)
    for (let t = -4999; t <= 5000; t += 7) {
      const cur = getSqrtPriceAtTick(t)
      expect(cur > prev).toBe(true)
      prev = cur
    }
  })
  it('rejects out-of-range / non-integer ticks', () => {
    expect(() => getSqrtPriceAtTick(MAX_TICK + 1)).toThrow()
    expect(() => getSqrtPriceAtTick(1.5)).toThrow()
  })
})

describe('getLiquidityForAmounts / getAmountsForLiquidity (LiquidityAmounts + SqrtPriceMath mirror)', () => {
  const A = getSqrtPriceAtTick(-23040) // ~ price 0.1
  const B = getSqrtPriceAtTick(23040) // ~ price 10
  const P = getSqrtPriceAtTick(0) // price 1

  it('in range: liquidity is the min of the two single-sided values; round-trip never over-delivers', () => {
    const amount0 = 1_000_000_000n // 1000 USDG-ish (6dp)
    const amount1 = 1_000_000_000n
    const L = getLiquidityForAmounts(P, A, B, amount0, amount1)
    expect(L > 0n).toBe(true)
    const back = getAmountsForLiquidity(P, A, B, L)
    expect(back.amount0 <= amount0).toBe(true)
    expect(back.amount1 <= amount1).toBe(true)
    // symmetric range around spot=1 with equal amounts ⇒ both legs are used almost fully (within rounding)
    expect(relErr(back.amount0, Number(amount0))).toBeLessThan(1e-6)
    expect(relErr(back.amount1, Number(amount1))).toBeLessThan(1e-6)
  })

  it('in range at price 1 with a symmetric range: L = amount1·2^96 / (sqrtP − sqrtA) (closed form)', () => {
    const amount = 10n ** 18n
    const L = getLiquidityForAmounts(P, A, B, amount, amount)
    const ref = Number(amount) / (1 - Number(A) / 2 ** 96) // sqrtP/2^96 = 1 at tick 0
    expect(relErr(L, ref)).toBeLessThan(1e-6)
  })

  it('a thinner second leg caps liquidity (the min branch)', () => {
    const Lfull = getLiquidityForAmounts(P, A, B, 10n ** 18n, 10n ** 18n)
    const Lhalf = getLiquidityForAmounts(P, A, B, 10n ** 18n, 5n * 10n ** 17n)
    expect(Lhalf < Lfull).toBe(true)
    expect(relErr(Lhalf, Number(Lfull) / 2)).toBeLessThan(1e-9)
  })

  it('below the range only amount0 funds liquidity; above it only amount1', () => {
    const below = getSqrtPriceAtTick(-30000)
    const above = getSqrtPriceAtTick(30000)
    expect(getLiquidityForAmounts(below, A, B, 10n ** 18n, 0n)).toBe(getLiquidityForAmounts(below, A, B, 10n ** 18n, 10n ** 18n))
    expect(getLiquidityForAmounts(above, A, B, 0n, 10n ** 18n)).toBe(getLiquidityForAmounts(above, A, B, 10n ** 18n, 10n ** 18n))
    expect(getLiquidityForAmounts(below, A, B, 0n, 10n ** 18n)).toBe(0n)
    expect(getAmountsForLiquidity(below, A, B, 10n ** 12n).amount1).toBe(0n)
    expect(getAmountsForLiquidity(above, A, B, 10n ** 12n).amount0).toBe(0n)
  })

  it('isInRange is strict on both bounds', () => {
    expect(isInRange(P, A, B)).toBe(true)
    expect(isInRange(A, A, B)).toBe(false)
    expect(isInRange(B, A, B)).toBe(false)
    expect(isInRange(P, B, A)).toBe(true) // unsorted input tolerated
  })

  it('zero liquidity ⇒ zero amounts', () => {
    expect(getAmountsForLiquidity(P, A, B, 0n)).toEqual({ amount0: 0n, amount1: 0n })
  })
})

describe('applyToleranceBps', () => {
  it('haircuts by bps, flooring', () => {
    expect(applyToleranceBps(10_000n, 100)).toBe(9_900n)
    expect(applyToleranceBps(1n, 100)).toBe(0n)
    expect(applyToleranceBps(12345n, 0)).toBe(12345n)
  })
  it('rejects nonsense tolerances', () => {
    expect(() => applyToleranceBps(1n, -1)).toThrow()
    expect(() => applyToleranceBps(1n, 10_000)).toThrow()
    expect(() => applyToleranceBps(1n, 1.5)).toThrow()
  })
})

describe('quoteToPairedAtSpot (earn-vs-lp decision: sizes the in-contract zap off-chain)', () => {
  it('at price 1.0 (Q96 itself), 1 quote ≈ 1 paired regardless of which currency is which', () => {
    const gotC0 = quoteToPairedAtSpot(1_000_000n, Q96, true)
    const gotC1 = quoteToPairedAtSpot(1_000_000n, Q96, false)
    expect(relErr(gotC0, 1_000_000)).toBeLessThan(1e-9)
    expect(relErr(gotC1, 1_000_000)).toBeLessThan(1e-9)
  })

  it('is the exact mirror-inverse of the contract-side conversion (round-trip ≈ identity)', () => {
    // sqrtP for a real, non-trivial tick (not exactly 1.0) — round-tripping quote→paired→quote should
    // return (approximately, modulo integer floor rounding) the original amount.
    const sqrtP = getSqrtPriceAtTick(12000)
    const quote = 12_345_678_901n
    const paired = quoteToPairedAtSpot(quote, sqrtP, true)
    // Inverse direction: treat `paired` as the new "quote" of the opposite currency and convert back.
    const back = quoteToPairedAtSpot(paired, sqrtP, false)
    expect(relErr(back, Number(quote))).toBeLessThan(1e-6)
  })

  it('zero in ⇒ zero out; scales linearly with the input amount', () => {
    expect(quoteToPairedAtSpot(0n, Q96, true)).toBe(0n)
    const sqrtP = getSqrtPriceAtTick(-6000)
    const a = quoteToPairedAtSpot(1_000_000n, sqrtP, false)
    const b = quoteToPairedAtSpot(2_000_000n, sqrtP, false)
    // 1e-4, not 1e-9: at these small integer magnitudes, floor-rounding in the two chained mulDiv calls is a
    // real, expected source of relative error -- the point of this test is linear scaling, not exactness.
    expect(relErr(b, Number(a) * 2)).toBeLessThan(1e-4)
  })
})

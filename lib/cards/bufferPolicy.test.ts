import { describe, it, expect } from 'vitest'
import {
  authorizeAgainstBuffer,
  refillPlan,
  checkRefillRate,
  type RefillRateState,
} from './bufferPolicy'

const USDC = (n: number): bigint => BigInt(Math.round(n * 1_000_000))

describe('authorizeAgainstBuffer — the flat ASA-window check', () => {
  it('approves when the buffer covers the amount', () => {
    expect(authorizeAgainstBuffer(USDC(20), USDC(100))).toEqual({ approved: true })
    expect(authorizeAgainstBuffer(USDC(100), USDC(100))).toEqual({ approved: true }) // exact
  })
  it('declines insufficient_buffer when the amount exceeds the balance', () => {
    expect(authorizeAgainstBuffer(USDC(120), USDC(100))).toEqual({ approved: false, reason: 'insufficient_buffer' })
  })
  it('declines over_per_tx_cap before checking balance', () => {
    // amount fits the buffer but exceeds the per-tx cap → cap wins
    expect(authorizeAgainstBuffer(USDC(80), USDC(100), USDC(50))).toEqual({ approved: false, reason: 'over_per_tx_cap' })
  })
  it('treats an undefined or 0 per-tx cap as no cap (off)', () => {
    expect(authorizeAgainstBuffer(USDC(80), USDC(100), undefined)).toEqual({ approved: true })
    expect(authorizeAgainstBuffer(USDC(80), USDC(100), 0n)).toEqual({ approved: true })
  })
  it('defensively declines zero/negative amounts', () => {
    expect(authorizeAgainstBuffer(0n, USDC(100))).toEqual({ approved: false, reason: 'insufficient_buffer' })
    expect(authorizeAgainstBuffer(USDC(-5), USDC(100))).toEqual({ approved: false, reason: 'insufficient_buffer' })
  })
})

describe('refillPlan — top back up to target', () => {
  it('refills the exact deficit', () => {
    expect(refillPlan({ bufferBalanceAtomic: USDC(30), targetAtomic: USDC(100) })).toEqual({
      shouldRefill: true,
      refillAmountAtomic: USDC(70),
    })
  })
  it('does nothing when at or above target', () => {
    expect(refillPlan({ bufferBalanceAtomic: USDC(100), targetAtomic: USDC(100) }).shouldRefill).toBe(false)
    expect(refillPlan({ bufferBalanceAtomic: USDC(150), targetAtomic: USDC(100) }).shouldRefill).toBe(false)
  })
  it('suppresses a trickle refill below the minimum threshold', () => {
    // $2 deficit, $10 min → don't churn
    expect(refillPlan({ bufferBalanceAtomic: USDC(98), targetAtomic: USDC(100), minRefillAtomic: USDC(10) })).toEqual({
      shouldRefill: false,
      refillAmountAtomic: 0n,
    })
    // $40 deficit, $10 min → refill
    expect(refillPlan({ bufferBalanceAtomic: USDC(60), targetAtomic: USDC(100), minRefillAtomic: USDC(10) })).toEqual({
      shouldRefill: true,
      refillAmountAtomic: USDC(40),
    })
  })
})

describe('checkRefillRate — the circuit breaker', () => {
  const fresh: RefillRateState = { windowStartSecs: 1000, refilledInWindowAtomic: 0n }
  const params = { capAtomic: USDC(500), windowSecs: 86_400 }

  it('permits refills up to the window cap', () => {
    const r = checkRefillRate(fresh, USDC(100), params, 1000)
    expect(r.allowed).toBe(true)
    expect(r.allowedAmountAtomic).toBe(USDC(100))
    expect(r.breakerTripped).toBe(false)
    expect(r.nextState.refilledInWindowAtomic).toBe(USDC(100))
  })

  it('trips and partially fills when a request exceeds remaining room', () => {
    const used: RefillRateState = { windowStartSecs: 1000, refilledInWindowAtomic: USDC(450) }
    const r = checkRefillRate(used, USDC(100), params, 1000) // only $50 room left
    expect(r.allowed).toBe(true)
    expect(r.allowedAmountAtomic).toBe(USDC(50))
    expect(r.breakerTripped).toBe(true)
    expect(r.nextState.refilledInWindowAtomic).toBe(USDC(500))
  })

  it('hard-trips (nothing permitted) once the cap is exhausted', () => {
    const maxed: RefillRateState = { windowStartSecs: 1000, refilledInWindowAtomic: USDC(500) }
    const r = checkRefillRate(maxed, USDC(10), params, 1000)
    expect(r.allowed).toBe(false)
    expect(r.allowedAmountAtomic).toBe(0n)
    expect(r.breakerTripped).toBe(true)
  })

  it('resets the accumulator when the window has elapsed', () => {
    const used: RefillRateState = { windowStartSecs: 1000, refilledInWindowAtomic: USDC(500) }
    const r = checkRefillRate(used, USDC(100), params, 1000 + 86_400) // window rolled
    expect(r.allowed).toBe(true)
    expect(r.allowedAmountAtomic).toBe(USDC(100))
    expect(r.nextState.windowStartSecs).toBe(1000 + 86_400)
    expect(r.nextState.refilledInWindowAtomic).toBe(USDC(100))
  })

  it('an open manual breaker halts everything, checked first', () => {
    const r = checkRefillRate(fresh, USDC(10), { ...params, breakerOpen: true }, 1000)
    expect(r.allowed).toBe(false)
    expect(r.allowedAmountAtomic).toBe(0n)
    expect(r.breakerTripped).toBe(true)
  })

  it('cap of 0 means unlimited (off)', () => {
    const r = checkRefillRate(fresh, USDC(9999), { capAtomic: 0n, windowSecs: 86_400 }, 1000)
    expect(r.allowed).toBe(true)
    expect(r.allowedAmountAtomic).toBe(USDC(9999))
    expect(r.breakerTripped).toBe(false)
  })

  it('ignores zero/negative requests', () => {
    expect(checkRefillRate(fresh, 0n, params, 1000).allowed).toBe(false)
  })
})

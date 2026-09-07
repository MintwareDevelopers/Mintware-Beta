import { describe, it, expect } from 'vitest'
import { nextDepositBasis, nextWithdrawBasis } from './basisMath'

describe('nextDepositBasis (M-04 deposit idempotency)', () => {
  it('adds quoteIn on a first-seen deposit tx', () => {
    expect(nextDepositBasis(1_000n, 500n, false)).toBe(1_500n)
    expect(nextDepositBasis(0n, 500n, false)).toBe(500n)
  })
  it('leaves the basis untouched when the tx was already recorded (replay no-op)', () => {
    expect(nextDepositBasis(1_000n, 500n, true)).toBe(1_000n)
  })
  it('replaying the same tx N times can never inflate the basis past one application', () => {
    let basis = 0n
    basis = nextDepositBasis(basis, 500n, false) // first time
    for (let i = 0; i < 10; i++) basis = nextDepositBasis(basis, 500n, true) // replays
    expect(basis).toBe(500n)
  })
})

describe('nextWithdrawBasis (M-04 withdraw idempotency)', () => {
  it('reduces basis proportionally to shares burned on a first-seen withdraw', () => {
    // prior basis 1000, burned 25 of 100 shares → 75 remain → basis 750
    expect(nextWithdrawBasis(1_000n, 75n, 25n, false)).toBe(750n)
  })
  it('full exit ⇒ zero basis', () => {
    expect(nextWithdrawBasis(1_000n, 0n, 100n, false)).toBe(0n)
  })
  it('leaves the basis untouched on a replay (no repeated deflation)', () => {
    expect(nextWithdrawBasis(1_000n, 75n, 25n, true)).toBe(1_000n)
  })
  it('replaying cannot deflate the basis toward zero', () => {
    let basis = 1_000n
    basis = nextWithdrawBasis(basis, 75n, 25n, false) // 750 once
    for (let i = 0; i < 10; i++) basis = nextWithdrawBasis(basis, 75n, 25n, true) // replays no-op
    expect(basis).toBe(750n)
  })
})

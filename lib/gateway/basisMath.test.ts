import { describe, it, expect } from 'vitest'
import { nextDepositBasis, nextWithdrawBasis, replayCostBasis, type BasisEvent } from './basisMath'

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

// Round-4 pass-2 event-order fix (independent Codex audit, 2026-09-09 — flagged in the pass-2 review,
// confirmed still outstanding after the earlier round-4 atomic-write fix, closed via migration
// 20260909000004). The bug: the OLD RPCs applied one nextDepositBasis/nextWithdrawBasis STEP per HTTP
// recording call, against gateway_positions.entry_nav's value AT CALL TIME — correct only if recording
// calls happen to arrive in the same order their on-chain txs were mined. `replayCostBasis` fixes this by
// recomputing the WHOLE basis from a position's full stored history, always in on-chain (block) order —
// so the same underlying deposit+withdraw pair produces the SAME correct basis no matter which HTTP call
// happened to reach the database first.
describe('replayCostBasis (event-order fix)', () => {
  it('a deposit then a withdraw, replayed in CHAIN order, matches sequential nextDepositBasis/nextWithdrawBasis', () => {
    // Deposit 1000, then withdraw half the shares (500 of 1000) ⇒ basis should halve to 500.
    const events: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 1_000n },
      { kind: 'withdraw', onChainShares: 500n, sharesBurned: 500n },
    ]
    expect(replayCostBasis(events)).toBe(500n)
    // Sanity: matches applying the single-step formulas by hand in the same order.
    let basis = nextDepositBasis(0n, 1_000n, false)
    basis = nextWithdrawBasis(basis, 500n, 500n, false)
    expect(replayCostBasis(events)).toBe(basis)
  })

  it('FIX PROVEN: replaying in chain order gives the CORRECT basis where the old call-order-dependent delta could not', () => {
    // The exact race this fix closes: a user deposits 1000 (block 100), then withdraws half their
    // shares (block 101). If the WITHDRAW's recording call reached the old RPC before the DEPOSIT's
    // call had recorded anything, the old incremental approach would apply nextWithdrawBasis against
    // a basis of 0 (nothing recorded yet) — producing 0 — and THEN the deposit's later call would just
    // add 1000 on top, landing on a final basis of 1000 (wrong: should reflect that half the position,
    // basis-wise, was withdrawn).
    const oldBuggyCallOrder_withdrawFirst = (() => {
      let basis = 0n
      basis = nextWithdrawBasis(basis, 500n, 500n, false) // withdraw's call processed FIRST (out of chain order)
      basis = nextDepositBasis(basis, 1_000n, false) // deposit's call processed SECOND
      return basis
    })()
    expect(oldBuggyCallOrder_withdrawFirst).toBe(1_000n) // the bug: basis is untouched by the withdrawal at all

    // The fix: regardless of which call reaches the database first, both events are STORED, and the
    // basis is recomputed by replaying them in their real CHAIN order (deposit's block 100 before
    // withdraw's block 101) — the withdraw call-arriving-first no longer matters.
    const eventsInChainOrder: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 1_000n },
      { kind: 'withdraw', onChainShares: 500n, sharesBurned: 500n },
    ]
    expect(replayCostBasis(eventsInChainOrder)).toBe(500n) // correct, and independent of HTTP call-arrival order
  })

  it('a full exit anywhere in the history zeroes the basis for everything replayed after it', () => {
    const events: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 1_000n },
      { kind: 'withdraw', onChainShares: 0n, sharesBurned: 1_000n }, // full exit
      { kind: 'deposit', quoteIn: 400n }, // a fresh deposit after the full exit
    ]
    expect(replayCostBasis(events)).toBe(400n) // the pre-exit basis contributes nothing
  })

  it('empty history ⇒ zero basis', () => {
    expect(replayCostBasis([])).toBe(0n)
  })

  it('multiple deposits then a partial withdraw compose correctly', () => {
    const events: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 600n },
      { kind: 'deposit', quoteIn: 400n }, // basis now 1000, shares now (say) 1000
      { kind: 'withdraw', onChainShares: 750n, sharesBurned: 250n }, // burn 250 of 1000 ⇒ basis × 750/1000
    ]
    expect(replayCostBasis(events)).toBe(750n)
  })
})

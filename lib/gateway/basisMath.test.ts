import { describe, it, expect } from 'vitest'
import { nextDepositBasis, nextWithdrawBasis, replayCostBasis, replayForGeneration, type BasisEvent, type PmTaggedEvent } from './basisMath'

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

// Manager-generation fix (independent Codex audit, round-4 pass-2, 2026-09-09). Migration
// 20260909000005's FIRST version (caught by Codex's live watch before it was ever committed) matched an
// ambiguous pre-migration legacy event (position_manager IS NULL) into EVERY generation's replay query,
// not just the one that adopted it — reproduced concretely as "PM-B basis 110 instead of [its own]" when
// PM-A had already legitimately absorbed a 10-unit legacy history plus its own 100-unit deposit.
describe('replayForGeneration / claimEvents (manager-generation fix)', () => {
  const PM_A = '0xaaaa'
  const PM_B = '0xbbbb'

  it('a generation that adopts unclaimed legacy history gets legacy + its own deposits', () => {
    const events: PmTaggedEvent[] = [
      { kind: 'deposit', quoteIn: 10n, positionManager: null, blockNumber: 100 }, // ambiguous pre-migration legacy
    ]
    const withNewDeposit: PmTaggedEvent[] = [...events, { kind: 'deposit', quoteIn: 100n, positionManager: PM_A, blockNumber: 200 }]
    const { basis } = replayForGeneration(withNewDeposit, PM_A)
    expect(basis).toBe(110n) // 10 (adopted legacy) + 100 (its own)
  })

  it('FIX PROVEN: a SEPARATE generation does NOT see the legacy history once another generation already claimed it', () => {
    const legacy: PmTaggedEvent = { kind: 'deposit', quoteIn: 10n, positionManager: null, blockNumber: 100 }
    const pmADeposit: PmTaggedEvent = { kind: 'deposit', quoteIn: 100n, positionManager: PM_A, blockNumber: 200 }

    // Call 1: PM-A's deposit call lands first — claims the legacy row (10) and adds its own 100 → 110.
    const afterA = replayForGeneration([legacy, pmADeposit], PM_A)
    expect(afterA.basis).toBe(110n)
    // The legacy event is now PERMANENTLY tagged PM_A in the (simulated) stored table.
    expect(afterA.events.find((e) => e.blockNumber === 100)?.positionManager).toBe(PM_A)

    // Call 2: a genuinely SEPARATE generation (PM-B) later makes its own, unrelated 5-unit deposit.
    // Reads the CURRENT (already-claimed) event table from call 1 — not the original `events` array.
    const pmBDeposit: PmTaggedEvent = { kind: 'deposit', quoteIn: 5n, positionManager: PM_B, blockNumber: 300 }
    const afterB = replayForGeneration([...afterA.events, pmBDeposit], PM_B)
    expect(afterB.basis).toBe(5n) // NOT 15 (5 + the already-claimed 10) and NOT 110 (PM-A's total)
  })

  it('the bug this reproduces: replaying WITHOUT claiming lets a later generation re-match the same legacy row', () => {
    // This is deliberately the OLD (buggy) behavior for contrast — plain replayCostBasis has no claim
    // step, so if a caller (incorrectly) fed it "exact-PM OR still-null" events for PM-B, the unclaimed
    // legacy row would double-count. Proves WHY the claim step in replayForGeneration is load-bearing.
    const legacy: BasisEvent = { kind: 'deposit', quoteIn: 10n }
    const pmBOwnDeposit: BasisEvent = { kind: 'deposit', quoteIn: 5n }
    const buggyPmBReplay = replayCostBasis([legacy, pmBOwnDeposit]) // legacy re-included — the bug
    expect(buggyPmBReplay).toBe(15n) // wrong: PM-B's real basis should be just its own 5
    // The fix (replayForGeneration, tested above) never lets this happen once PM-A has claimed `legacy`.
  })
})

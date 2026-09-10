import { describe, it, expect } from 'vitest'
import { nextDepositBasis, nextWithdrawBasis, replayCostBasis, type BasisEvent, type ReplayResult } from './basisMath'

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

// Round-4 pass-2 event-order + same-block VALUE fix (independent Codex audit, 2026-09-09). The OLD RPCs
// applied one nextDepositBasis/nextWithdrawBasis STEP per HTTP recording call, against the row's value AT
// CALL TIME — correct only if recording calls happen to arrive in the same order their on-chain txs were
// mined. Migration 20260909000004 fixed that by replaying the whole stored history in on-chain (block)
// order. Codex's live watch then confirmed a DEEPER bug even with correct ordering: reading `onChainShares`
// per event from chain (`sharesOf(user, blockNumber)`) returns the BLOCK-END balance — wrong for an
// earlier of two same-block transactions by the same user, regardless of order. `replayCostBasis` now
// DERIVES shares purely from each event's own sharesMinted/sharesBurned — never a chain read — so it is
// immune to call-order, cross-block, AND same-block ambiguity alike.
function ok(r: ReplayResult): { basis: bigint; finalShares: bigint } {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`)
  return r
}

describe('replayCostBasis (event-order + same-block VALUE fix)', () => {
  it('a deposit then a withdraw, replayed in CHAIN order, matches sequential nextDepositBasis/nextWithdrawBasis', () => {
    // Deposit 1000 (mints 1000 shares), then withdraw half the shares (burns 500) ⇒ basis halves to 500.
    const events: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 1_000n, sharesMinted: 1_000n },
      { kind: 'withdraw', sharesBurned: 500n },
    ]
    expect(ok(replayCostBasis(events)).basis).toBe(500n)
    expect(ok(replayCostBasis(events)).finalShares).toBe(500n)
    // Sanity: matches applying the single-step formulas by hand in the same order (onChainShares derived
    // as 1000 - 500 = 500, exactly what the replay computes internally).
    let basis = nextDepositBasis(0n, 1_000n, false)
    basis = nextWithdrawBasis(basis, 500n, 500n, false)
    expect(ok(replayCostBasis(events)).basis).toBe(basis)
  })

  it('FIX PROVEN: replaying in chain order gives the CORRECT basis where the old call-order-dependent delta could not', () => {
    // The exact race this fix closes: a user deposits 1000 (block 100, mints 1000 shares), then withdraws
    // half (block 101, burns 500). If the WITHDRAW's recording call reached the old RPC before the
    // DEPOSIT's call had recorded anything, the old incremental approach would apply nextWithdrawBasis
    // against a basis of 0 (nothing recorded yet) — producing 0 — and THEN the deposit's later call would
    // just add 1000 on top, landing on a final basis of 1000 (wrong).
    const oldBuggyCallOrder_withdrawFirst = (() => {
      let basis = 0n
      basis = nextWithdrawBasis(basis, 500n, 500n, false) // withdraw's call processed FIRST (out of chain order)
      basis = nextDepositBasis(basis, 1_000n, false) // deposit's call processed SECOND
      return basis
    })()
    expect(oldBuggyCallOrder_withdrawFirst).toBe(1_000n) // the bug: basis is untouched by the withdrawal at all

    // The fix: regardless of which call reaches the database first, both events are STORED, and the
    // basis is recomputed by replaying them in their real CHAIN order — the withdraw call-arriving-first
    // no longer matters.
    const eventsInChainOrder: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 1_000n, sharesMinted: 1_000n },
      { kind: 'withdraw', sharesBurned: 500n },
    ]
    expect(ok(replayCostBasis(eventsInChainOrder)).basis).toBe(500n) // correct, independent of call-arrival order
  })

  it('FIX PROVEN (same-block VALUE): two same-block withdrawals from the same user replay correctly — no block-end-balance corruption', () => {
    // Deposit 1000 shares, then TWO withdrawals in the SAME block (tx_index only distinguishes call
    // order — sharesOf(blockNumber) would have returned the SAME block-end balance for both under the
    // old design). Burn 300 then 200 (500 total). Derived-shares replay gets each step's TRUE post-tx
    // balance (700, then 500) purely from sharesBurned — never a block-level read.
    const events: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 1_000n, sharesMinted: 1_000n },
      { kind: 'withdraw', sharesBurned: 300n }, // tx_index 0 in the block: 1000 → 700
      { kind: 'withdraw', sharesBurned: 200n }, // tx_index 1 in the block: 700 → 500
    ]
    const r = ok(replayCostBasis(events))
    expect(r.finalShares).toBe(500n)
    // basis after first withdraw: 1000 * 700/1000 = 700; after second: 700 * 500/700 = 500
    expect(r.basis).toBe(500n)
  })

  it('a full exit anywhere in the history zeroes the basis for everything replayed after it', () => {
    const events: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 1_000n, sharesMinted: 1_000n },
      { kind: 'withdraw', sharesBurned: 1_000n }, // full exit
      { kind: 'deposit', quoteIn: 400n, sharesMinted: 400n }, // a fresh deposit after the full exit
    ]
    expect(ok(replayCostBasis(events)).basis).toBe(400n) // the pre-exit basis contributes nothing
  })

  it('empty history ⇒ zero basis, zero shares', () => {
    const r = ok(replayCostBasis([]))
    expect(r.basis).toBe(0n)
    expect(r.finalShares).toBe(0n)
  })

  it('multiple deposits then a partial withdraw compose correctly', () => {
    const events: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 600n, sharesMinted: 600n },
      { kind: 'deposit', quoteIn: 400n, sharesMinted: 400n }, // basis now 1000, shares now 1000
      { kind: 'withdraw', sharesBurned: 250n }, // burn 250 of 1000 ⇒ basis × 750/1000
    ]
    expect(ok(replayCostBasis(events)).basis).toBe(750n)
  })

  it('a withdraw that would burn more shares than minted so far is reported, not clamped or thrown', () => {
    // A genuine data-completeness gap — e.g. an earlier deposit whose OWN recording call never landed.
    const events: BasisEvent[] = [
      { kind: 'deposit', quoteIn: 100n, sharesMinted: 100n },
      { kind: 'withdraw', sharesBurned: 500n }, // more than the 100 minted so far
    ]
    const r = replayCostBasis(events)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('insufficient_shares')
  })
})

// Manager-generation fix (independent Codex audit, round-4 pass-2, 2026-09-09 → revised 2026-09-10).
// Two prior designs both guessed at ambiguous pre-existing history and were both caught by Codex's live
// watch before ever being applied — a migration-time "prefer the active PM" backfill, then a runtime
// "first write to name any real PM adopts the whole unclaimed history" rule (which fixed the immediate
// double-count but not the deeper flaw: whichever PM asks FIRST still wins a guess that might be wrong).
// Final fix: NO guessing anywhere — every generation is isolated by a plain EXACT positionManager filter;
// an unresolved (positionManager: null) event is simply excluded from every generation's replay, full
// stop, until something else (real on-chain receipt lookup) resolves it to a specific PM.
type PmTaggedEvent = (BasisEvent & { positionManager: string | null; blockNumber: number; txIndex: number | null })
function replayExact(events: PmTaggedEvent[], pm: string): ReplayResult {
  const mine = events
    .filter((e) => e.positionManager === pm)
    .sort((a, b) => a.blockNumber - b.blockNumber || (a.txIndex ?? -1) - (b.txIndex ?? -1))
  return replayCostBasis(mine)
}

describe('exact-match generation isolation (manager-generation fix, final design)', () => {
  const PM_A = '0xaaaa'
  const PM_B = '0xbbbb'

  it('FIX PROVEN: an unresolved (null-PM) legacy event is invisible to EVERY generation — never guessed, never inherited', () => {
    const legacy: PmTaggedEvent = { kind: 'deposit', quoteIn: 10n, sharesMinted: 10n, positionManager: null, blockNumber: 100, txIndex: 0 }
    const pmADeposit: PmTaggedEvent = { kind: 'deposit', quoteIn: 100n, sharesMinted: 100n, positionManager: PM_A, blockNumber: 200, txIndex: 0 }
    const pmBDeposit: PmTaggedEvent = { kind: 'deposit', quoteIn: 5n, sharesMinted: 5n, positionManager: PM_B, blockNumber: 300, txIndex: 0 }
    const events = [legacy, pmADeposit, pmBDeposit]

    // Neither generation inherits the ambiguous legacy 10 — each sees ONLY its own exact-match events.
    expect(ok(replayExact(events, PM_A)).basis).toBe(100n) // NOT 110
    expect(ok(replayExact(events, PM_B)).basis).toBe(5n) // NOT 15, NOT 105
    // The legacy event itself contributes to NEITHER — it stays genuinely unresolved (a null-PM query
    // would need a dedicated resolver, not a replay call — this file no longer has one, by design).
  })

  it('a brand-new generation deposit does NOT touch a coexisting unresolved legacy row for the same identity', () => {
    const legacy: PmTaggedEvent = { kind: 'deposit', quoteIn: 999999n, sharesMinted: 1n, positionManager: null, blockNumber: 50, txIndex: 0 }
    const pmADeposit: PmTaggedEvent = { kind: 'deposit', quoteIn: 100n, sharesMinted: 100n, positionManager: PM_A, blockNumber: 200, txIndex: 0 }
    expect(ok(replayExact([legacy, pmADeposit], PM_A)).basis).toBe(100n) // exactly its own, nothing borrowed
  })

  it('same-block ordering tiebreak: txIndex, not array/insertion order, decides same-block replay order', () => {
    // Both events share block 100 — only txIndex distinguishes their real on-chain order. Fed in the
    // WRONG array order deliberately; the exact-match filter+sort must still order by (blockNumber, txIndex).
    const withdrawFirstInArray: PmTaggedEvent = { kind: 'withdraw', sharesBurned: 300n, positionManager: PM_A, blockNumber: 100, txIndex: 1 }
    const depositSecondInArray: PmTaggedEvent = { kind: 'deposit', quoteIn: 1_000n, sharesMinted: 1_000n, positionManager: PM_A, blockNumber: 100, txIndex: 0 }
    const result = replayExact([withdrawFirstInArray, depositSecondInArray], PM_A)
    // Correct chain order is deposit (txIndex 0) THEN withdraw (txIndex 1) — basis 1000 * 700/1000 = 700.
    expect(ok(result).basis).toBe(700n)
  })
})

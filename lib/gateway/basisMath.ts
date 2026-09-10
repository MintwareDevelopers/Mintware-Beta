// LP-gateway cost-basis math (M-04). Pure, idempotent-aware helpers documenting the exact formula the
// deposit/withdraw routes' entry_nav updates use — `alreadyRecorded` is true when the tx already exists
// in gateway_deposit_events (UNIQUE tx_hash), in which case the basis is left exactly as-is (the
// mutation was applied once, the first time the tx was seen).
//
// Round-4 audit fix (2026-09-09): the routes no longer call these functions directly — the actual
// mutation moved into one atomic RPC per direction (record_gateway_deposit_event /
// record_gateway_withdraw_event, supabase/migrations/20260909000001_gateway_position_atomic_writes.sql)
// so the idempotency claim and the basis write happen in a single transaction instead of two separate
// round-trips (which could strand a missed increment on a crash, or lose one of two concurrent writers'
// contributions to a read-modify-write race). These functions are KEPT as the reference spec the SQL
// mirrors and stay covered by basisMath.test.ts — the SQL's CASE expressions are the same formula,
// just evaluated atomically against the row's live value instead of a value read in JS beforehand.
//
// Round-4 pass-2 event-order fix (independent Codex audit, 2026-09-09 — see `replayCostBasis` below):
// applying one of these STEPS per HTTP recording call (as 20260909000001 did) is only correct if calls
// arrive in the same order their txs were mined — nothing guaranteed that. Migration 20260909000004
// moved the RPCs from "apply one delta against the row's current value" to "replay the position's whole
// stored history in on-chain block order, from zero, every time" — order-independent w.r.t. call
// arrival. `nextDepositBasis`/`nextWithdrawBasis` are unchanged (still the single-step formulas); they're
// now composed by `replayCostBasis` instead of applied directly against a stored running total.

/** Deposit: additive cost basis, applied at most once per deposit tx. */
export function nextDepositBasis(priorBasis: bigint, quoteIn: bigint, alreadyRecorded: boolean): bigint {
  if (alreadyRecorded) return priorBasis
  return priorBasis + quoteIn
}

/** Withdraw: reduce cost basis proportionally to the shares burned (full exit ⇒ 0), applied at most
 *  once per withdraw tx. `onChainShares` is the LIVE post-burn balance; `sharesBurned` is from the
 *  Withdrawn event, so priorShares = onChainShares + sharesBurned. */
export function nextWithdrawBasis(
  priorBasis: bigint,
  onChainShares: bigint,
  sharesBurned: bigint,
  alreadyRecorded: boolean,
): bigint {
  if (alreadyRecorded) return priorBasis
  const priorShares = onChainShares + sharesBurned
  if (onChainShares === 0n || priorShares === 0n) return 0n
  return (priorBasis * onChainShares) / priorShares
}

// ── Event-order fix (independent Codex audit, round-4 pass-2, 2026-09-09) ──────────────────────────────
//
// nextDepositBasis/nextWithdrawBasis above are each a single STEP. The original RPCs (migration
// 20260909000001) applied one step per HTTP recording call, against gateway_positions.entry_nav's
// CURRENT value at write time — which is correct ONLY if recording calls for the same position always
// arrive in the same order their underlying on-chain txs were mined in. Nothing enforced that: a
// deposit's and a withdraw's recording calls are two independent HTTP requests (client retries, network
// jitter, a user acting from two tabs), so the WITHDRAW's call could reach the RPC before the earlier
// (lower-block) DEPOSIT's call had recorded — the proportional reduction would then apply to a basis
// that hadn't yet incorporated that deposit, and the deposit's own later call would just add quoteIn on
// top, landing on a final basis that doesn't match either transaction's actual on-chain order.
//
// Fix: instead of one incremental delta per call, every recording call now replays the position's
// ENTIRE stored event history — ordered by the events' own on-chain block number, never by call-arrival
// order — into a fresh basis from zero. This makes the recorded cost basis a pure function of on-chain
// history: identical no matter what order the HTTP calls happen to arrive in. `BasisEvent` mirrors what
// migration 20260909000004 now stores per row (block_number + kind-specific fields); the SQL RPCs are a
// line-for-line mirror of this loop (see that migration's comment).

export type BasisEvent =
  | { kind: 'deposit'; quoteIn: bigint }
  | { kind: 'withdraw'; onChainShares: bigint; sharesBurned: bigint }

/** Replays a position's full recorded history (already sorted into on-chain order — by block number,
 *  the caller's job) into a final cost basis. Each event is applied as a fresh (never `alreadyRecorded`)
 *  step — idempotency against a REPLAYED tx is handled upstream by never storing the same tx_hash twice
 *  (UNIQUE constraint), not by this function, which only ever sees each recorded tx once per replay. */
export function replayCostBasis(eventsInChainOrder: BasisEvent[]): bigint {
  let basis = 0n
  for (const e of eventsInChainOrder) {
    basis = e.kind === 'deposit'
      ? nextDepositBasis(basis, e.quoteIn, false)
      : nextWithdrawBasis(basis, e.onChainShares, e.sharesBurned, false)
  }
  return basis
}

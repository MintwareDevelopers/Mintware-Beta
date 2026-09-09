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

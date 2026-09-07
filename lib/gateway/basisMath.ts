// LP-gateway cost-basis math (M-04). Pure, idempotent-aware helpers so the deposit/withdraw routes'
// entry_nav updates can't be inflated/deflated by replaying an on-chain txHash. `alreadyRecorded` is
// true when the tx already exists in gateway_deposit_events (UNIQUE tx_hash) — in which case the basis
// is left exactly as-is (the mutation was applied once, the first time the tx was seen).

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

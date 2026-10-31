// "Put in" for a MarketEngine position, rebuilt from its receipt-verified events (market_engine_tx_events).
//
// Average-cost method, in the market's quote asset:
//   · deposit  → basis += quote amount deposited; shares += shares minted
//   · withdraw → basis -= basis × sharesBurned / sharesBefore; shares -= sharesBurned
// A deposit that included the non-quote token can't be valued without the price at that block, so the basis is
// reported incomplete. The basis is also incomplete when the replayed share count doesn't match the wallet's
// on-chain shares (a deposit made outside the app, a failed record, or a share transfer). Incomplete means the
// page shows "unavailable" — it never guesses.

export type EngineEvent = {
  action: 'deposit' | 'withdraw'
  sharesAtomic: bigint
  amount0Atomic: bigint
  amount1Atomic: bigint
  blockNumber: bigint
  txIndex: number
}

export type CostBasis = { basisAtomic: bigint | null; complete: boolean }

export function computeCostBasis(events: EngineEvent[], onChainShares: bigint, quoteIs0: boolean): CostBasis {
  const ordered = [...events].sort((a, b) => (a.blockNumber === b.blockNumber ? a.txIndex - b.txIndex : a.blockNumber < b.blockNumber ? -1 : 1))
  let basis = 0n
  let shares = 0n
  for (const e of ordered) {
    if (e.action === 'deposit') {
      const quoteIn = quoteIs0 ? e.amount0Atomic : e.amount1Atomic
      const otherIn = quoteIs0 ? e.amount1Atomic : e.amount0Atomic
      if (otherIn > 0n) return { basisAtomic: null, complete: false }
      basis += quoteIn
      shares += e.sharesAtomic
    } else {
      if (e.sharesAtomic > shares || shares === 0n) return { basisAtomic: null, complete: false }
      basis -= (basis * e.sharesAtomic) / shares
      shares -= e.sharesAtomic
    }
  }
  if (shares !== onChainShares) return { basisAtomic: null, complete: false }
  return { basisAtomic: basis, complete: true }
}

// Bridge post-spend reconciliation — the "spend, still earning" loop for the Bridge rail.
//
// On Bridge WE don't authorize (no ASA hold, so no reservation to release — that ledger is Lithic-
// only). Bridge pulls USDC straight from the buffer wallet at auth. Our job on each spend event is
// simply: reconcile the cached balance from chain, then top the buffer back up toward target by
// redeeming a slice of the vault (Gateway.refillBuffer). A refund flows the other way (balance goes
// UP), so it only needs a resync, never a refill.
//
// Pure orchestration over injected deps → unit-testable without a live Bridge/chain. The webhook route
// supplies the real syncBufferBalance + refillCardBuffer.

export type BridgeEventKind = 'spend' | 'refund' | 'ignore'

/** A card spend/refund event normalized off a Bridge/Stripe issuing webhook (see bridgeClient.ts). */
export interface NormalizedBridgeEvent {
  kind: BridgeEventKind
  /** Our org_card id resolved from the issuer's card token, if this event maps to a known card. */
  orgCardId?: string
  /** Signed atomic USDC amount of the movement (informational; refill sizes off on-chain truth). */
  amountAtomic?: bigint
  /** Issuer event id (idempotency / logging). */
  eventId?: string
}

export interface ReconcileDeps {
  /** Reconcile the DB balance cache from on-chain `usdc.balanceOf(bufferOf[user])`. */
  syncBuffer(orgCardId: string): Promise<void>
  /** Redeem a vault slice back into the buffer toward target. Returns the refill outcome. */
  refill(orgCardId: string, trigger: string): Promise<{ ok: boolean; reason?: string }>
  log?(msg: string, meta?: Record<string, unknown>): void
}

export type ReconcileResult =
  | { action: 'refilled' }
  | { action: 'refill_skipped'; reason?: string }
  | { action: 'synced' } // refund or non-spend movement: balance updated, no refill needed
  | { action: 'ignored' }
  | { action: 'no_card' }

/**
 * React to one normalized Bridge event. Spend → resync + refill; refund → resync only; anything else
 * → ignore. Never throws for a well-formed event (the webhook must ack 200 so Bridge doesn't retry-
 * storm); a failed refill is reported, not raised.
 */
export async function reconcileBridgeEvent(
  ev: NormalizedBridgeEvent,
  deps: ReconcileDeps,
): Promise<ReconcileResult> {
  if (ev.kind === 'ignore') return { action: 'ignored' }
  if (!ev.orgCardId) return { action: 'no_card' }

  await deps.syncBuffer(ev.orgCardId)

  if (ev.kind === 'refund') {
    deps.log?.('bridge.reconcile.refund', { orgCardId: ev.orgCardId, eventId: ev.eventId })
    return { action: 'synced' }
  }

  // kind === 'spend'
  const res = await deps.refill(ev.orgCardId, 'bridge_spend')
  if (res.ok) return { action: 'refilled' }
  return { action: 'refill_skipped', reason: res.reason }
}

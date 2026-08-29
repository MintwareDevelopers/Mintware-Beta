// Recorder for the unified org-treasury spend ledger (`treasury_spend_events`, migration
// 20260829000001). Every spend rail writes here so a team can see + report on every dollar that
// moved. Mirrors the two proven patterns:
//   • card_swipe_events (lib/org/settleSwipe.ts) — an AWAITED lifecycle row whose `settled` flag is
//     durable and gated on receipt.status === 'success'; and
//   • settleLog.ts — a fire-and-forget mirror that must never block a settle path.
//
// Recording must never break a payment: the awaited helpers catch + log and return a soft signal
// (empty ids / void) rather than throwing. Reads go through a server route on the service-role
// client (deny-all RLS), never the browser.

import { getServiceClient } from '@/lib/web2/supabase'
import { log } from '@/lib/logger'

export type SpendType = 'vendor_pay' | 'payroll' | 'card_swipe' | 'x402' | 'deposit' | 'withdraw'
export type SpendStatus = 'recorded' | 'settled' | 'failed'

export interface SpendRow {
  orgId: string
  spendType: SpendType
  toWallet: string
  amountAtomicUsdc: string
  provider?: string | null
  providerEventRef?: string | null
  batchId?: string | null
  initiatedBy?: string | null
  initiatorRole?: string | null
  fromWallet?: string | null
  asset?: string
  chainId?: number | null
  category?: string | null
  memo?: string | null
  status?: SpendStatus
  settled?: boolean
  settleTx?: string | null
}

function toDbRow(r: SpendRow) {
  return {
    org_id: r.orgId,
    spend_type: r.spendType,
    provider: r.provider ?? null,
    provider_event_ref: r.providerEventRef ?? null,
    batch_id: r.batchId ?? null,
    initiated_by: r.initiatedBy?.toLowerCase() ?? null,
    initiator_role: r.initiatorRole ?? null,
    from_wallet: r.fromWallet?.toLowerCase() ?? null,
    to_wallet: r.toWallet.toLowerCase(),
    amount_atomic_usdc: r.amountAtomicUsdc,
    asset: r.asset ?? 'USDC',
    chain_id: r.chainId ?? null,
    category: r.category ?? null,
    memo: r.memo ?? null,
    status: r.status ?? 'recorded',
    settled: r.settled ?? false,
    settle_tx: r.settleTx ?? null,
  }
}

/** Record N spend rows (awaited). Returns the inserted row ids in order, or [] on failure — never
 *  throws, because a recording failure must not break the pay flow (it is surfaced via the logger). */
export async function recordSpendEvents(rows: SpendRow[]): Promise<string[]> {
  if (rows.length === 0) return []
  try {
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('treasury_spend_events')
      .insert(rows.map(toDbRow))
      .select('id')
    if (error) {
      log.error('treasury-spend-log', 'Insert failed', { message: error.message })
      return []
    }
    return (data ?? []).map((d: { id: string }) => d.id)
  } catch (err) {
    log.error('treasury-spend-log', 'Threw synchronously', { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

/** Mark a recorded spend settled — call ONLY after the tx mined with receipt.status === 'success'
 *  (mirrors the settleSwipe.ts reconciliation rule; a reverted tx must never be recorded settled). */
export async function markSpendSettled(
  id: string,
  fields: { settleTx: string; sharesBurned?: string | null },
): Promise<void> {
  try {
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('treasury_spend_events')
      .update({
        status: 'settled',
        settled: true,
        settle_tx: fields.settleTx,
        receipt_status: 'success',
        shares_burned: fields.sharesBurned ?? null,
        settled_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) log.error('treasury-spend-log', 'Settle-mark failed', { id, message: error.message })
  } catch (err) {
    log.error('treasury-spend-log', 'Settle-mark threw', { id, err: err instanceof Error ? err.message : String(err) })
  }
}

/** Mark a recorded spend failed (settle reverted or errored). */
export async function markSpendFailed(id: string, reason: string): Promise<void> {
  try {
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('treasury_spend_events')
      .update({ status: 'failed', error_reason: reason })
      .eq('id', id)
    if (error) log.error('treasury-spend-log', 'Fail-mark failed', { id, message: error.message })
  } catch (err) {
    log.error('treasury-spend-log', 'Fail-mark threw', { id, err: err instanceof Error ? err.message : String(err) })
  }
}

/** Sum a member's already-recorded (non-failed) spend for the current UTC day, atomic 6dp USDC.
 *  Powers the CUMULATIVE daily cap — the pay route feeds this to withinDailyCap so a capped role
 *  can't exceed its cap across multiple batches in one day (the pre-ledger gap). */
export async function spentTodayAtomic(orgId: string, memberWallet: string): Promise<bigint> {
  try {
    const supabase = getServiceClient()
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    const { data, error } = await supabase
      .from('treasury_spend_events')
      .select('amount_atomic_usdc')
      .eq('org_id', orgId)
      .eq('initiated_by', memberWallet.toLowerCase())
      .neq('status', 'failed')
      .gte('created_at', start.toISOString())
    if (error) {
      log.error('treasury-spend-log', 'spentToday query failed', { message: error.message })
      return 0n // fail-open on the read: never block a legitimate pay because the ledger read hiccuped
    }
    return (data ?? []).reduce((acc: bigint, r: { amount_atomic_usdc: string }) => {
      try { return acc + BigInt(r.amount_atomic_usdc) } catch { return acc }
    }, 0n)
  } catch (err) {
    log.error('treasury-spend-log', 'spentToday threw', { err: err instanceof Error ? err.message : String(err) })
    return 0n
  }
}

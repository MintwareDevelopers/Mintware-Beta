// Best-effort, fire-and-forget log of every x402 settle attempt to `x402_settle_events`
// (migration 20260828000002). Pure observability — a logging failure must NEVER block or
// fail a real payment settlement, so this never throws and is never awaited by callers.
//
// Called from the two Facilitator.settle() implementations (facilitator.ts, directFacilitator.ts)
// — the single choke point every settle call funnels through, regardless of which route
// (/api/x402/settle, /api/x402/score, /api/x402/scores) triggered it.

import { getServiceClient } from '@/lib/web2/supabase'
import { log } from '@/lib/logger'
import { PaymentRequirements, PaymentPayload, SettleResult } from './types'

export type SettleProvider = 'direct' | 'relayer' | 'oracle' | 'deferred'

/** Fire-and-forget — do not `await` this in a settle path. */
export function logSettleEvent(
  reqs: PaymentRequirements,
  payload: PaymentPayload,
  result: SettleResult,
  provider: SettleProvider,
  holdId?: string
): void {
  try {
    const supabase = getServiceClient()
    supabase
      .from('x402_settle_events')
      .insert({
        payer: payload.payload.authorization.from.toLowerCase(),
        payee: reqs.payTo.toLowerCase(),
        resource: reqs.resource,
        network: reqs.network,
        asset: reqs.asset,
        amount_atomic: payload.payload.authorization.value,
        provider,
        success: result.success,
        tx_hash: result.txHash ?? null,
        error_reason: result.errorReason ?? null,
        hold_id: holdId ?? null,
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) log.error('x402-settle-log', 'Insert failed', { message: error.message })
      })
  } catch (err) {
    log.error('x402-settle-log', 'Threw synchronously', { err: err instanceof Error ? err.message : String(err) })
  }
}

// Lithic capture/settlement webhook — the AUTOMATIC counterpart to the manual "Settle" button.
//
// The ASA webhook (../webhook) only DECIDES a swipe (an off-chain NAV hold). Actually clearing the
// charge on-chain (burning shares via settleSpend) has, until now, required a human to click "Settle"
// — that click IS the review checkpoint. This route removes the human from the loop for SMALL,
// already-approved swipes: when Lithic reports the card network cleared the charge
// (`card_transaction.updated` → status SETTLED), it runs the exact same settle logic the button runs.
//
// ── The safety valve (this is the real decision, not the plumbing) ──────────────────────────────
// Auto-settle is OFF by default and gated three ways, so enabling an unsupervised signer is a
// deliberate ops act, never a silent default:
//   1. LITHIC_AUTO_SETTLE_ENABLED must be exactly 'true' — otherwise every capture is acked and left
//      for a human to settle manually (nothing moves).
//   2. LITHIC_AUTO_SETTLE_MAX_USD (default $50) — anything above this is left for manual review.
//   3. The shared core still hard-refuses ≥ $250 (the gateway's edge-signed-auth boundary).
// Anything the valve refuses is simply left unsettled → it shows up in the feed for a manual click,
// exactly as today. The blast radius of the automated key is bounded to ≤ $50 approved swipes.
//
// Always acks 200 (except signature failure/unconfigured) so Lithic doesn't retry-storm; a settle
// that didn't happen (disabled, over cap, or a transient tx error) just stays manual — the safe
// fallback. Idempotent: the shared core + the on-chain holds[holdId].settled guard make a duplicate
// delivery a no-op. Manual auth (Lithic signs with its own scheme), same category as the ASA route.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { verifyCaptureRequest } from '@/lib/cards/lithic'
import { settleSwipeEvent, CARD_HIGH_VALUE_THRESHOLD } from '@/lib/org/settleSwipe'
import { syncBufferBalance } from '@/lib/org/bufferMonitor'
import { refillCardBuffer } from '@/lib/org/bufferRefill'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Resolve the auto-settle ceiling (atomic 6dp USDC), hard-capped just under the gateway's $250
 *  edge-sig boundary. Default $50. */
function autoSettleCeilingAtomic(): bigint {
  const usd = Number(process.env.LITHIC_AUTO_SETTLE_MAX_USD ?? '50')
  const safeUsd = Number.isFinite(usd) && usd > 0 ? usd : 50
  const atomic = BigInt(Math.round(safeUsd * 1_000_000))
  const ceiling = CARD_HIGH_VALUE_THRESHOLD - 1n // must stay strictly below the high-value threshold
  return atomic < ceiling ? atomic : ceiling
}

export const POST = createHandler(async (req: NextRequest, ctx) => {
  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k] = v })

  const verified = verifyCaptureRequest(rawBody, headers)
  if (!verified.ok) {
    if (verified.reason === 'unconfigured') return ctx.json({ error: 'lithic_capture_webhook_unconfigured' }, 503)
    if (verified.reason === 'not_a_card_transaction') return ctx.json({ ok: true, ignored: true }, 200) // some other event type — ack, no-op
    ctx.log.warn('cards.lithic', 'capture signature verification failed')
    return ctx.json({ error: 'invalid_signature' }, 401)
  }

  const txn = verified.event
  const token = txn.token
  if (!token) return ctx.json({ ok: true, ignored: true }, 200)

  // `card_transaction.updated` fires across the lifecycle. Two terminal outcomes matter to a buffer
  // reservation: SETTLED = the charge cleared (realize the hold); a REVERSAL = the auth will NEVER
  // capture (free the hold — audit re-audit R1: without this, every voided/expired pre-auth leaks
  // reserved_atomic forever and eventually starves a funded buffer). Anything else is acked + ignored.
  const status = String(txn.status ?? '')
  const REVERSAL_STATUSES = new Set(['VOIDED', 'EXPIRED', 'AUTHORIZATION_EXPIRED', 'REVERSED', 'DECLINED'])
  const isSettled = status === 'SETTLED'
  const isReversal = REVERSAL_STATUSES.has(status)
  if (!isSettled && !isReversal) return ctx.json({ ok: true, ignored: true, status }, 200)

  // Match back to the swipe the ASA webhook authorized (provider_event_ref = the same transaction token).
  const { data: swipe } = await ctx.supabase
    .from('card_swipe_events')
    .select('id, org_id, org_card_id, decision, settled, amount_atomic_usdc, auth_mode')
    .eq('provider', 'lithic').eq('provider_event_ref', token).maybeSingle()
  if (!swipe) { ctx.log.info('cards.lithic', 'capture for an unknown/foreign transaction — ignored', { token }); return ctx.json({ ok: true, ignored: true }, 200) }
  if (swipe.decision !== 'approved') return ctx.json({ ok: true, ignored: true, reason: 'not_approved' }, 200)
  if (swipe.settled) return ctx.json({ ok: true, already_settled: true }, 200) // fast idempotency path

  // ── Buffer mode (docs/developers/card-spend-buffer-spec.md §5) ──
  // Branch on HOW THE SWIPE WAS AUTHORIZED (auth_mode), not on whether a buffer row exists now (audit H2).
  if (swipe.auth_mode === 'buffer' && swipe.org_card_id) {
    // Claim the terminal transition ATOMICALLY (re-audit R6): a conditional settled=false→true update, so
    // concurrent/duplicate capture deliveries can't both release the hold (a double-release would re-open
    // the C1 over-approval). Only the row-update winner proceeds.
    const { data: claimed } = await ctx.supabase
      .from('card_swipe_events')
      .update({ settled: true, settled_at: new Date().toISOString() })
      .eq('id', swipe.id).eq('settled', false).select('id')
    if (!claimed || claimed.length === 0) return ctx.json({ ok: true, already_settled: true }, 200) // lost the race

    // Release the auth reservation on EITHER terminal outcome (re-audit R1): a capture realizes it,
    // a reversal frees it. release_card_buffer floors at 0 so a stray extra release is harmless.
    await ctx.supabase.rpc('release_card_buffer', { p_org_card_id: swipe.org_card_id, p_amount: String(swipe.amount_atomic_usdc) })

    if (isReversal) {
      ctx.log.info('cards.lithic', 'buffer auth reversed — reservation released', { eventId: swipe.id, status })
      return ctx.json({ ok: true, reversed: true, mode: 'buffer', status }, 200)
    }
    // SETTLED: the buffer already paid the merchant — reconcile from chain + enqueue a refill (no settleSpend).
    await syncBufferBalance({ supabase: ctx.supabase, orgId: swipe.org_id, orgCardId: swipe.org_card_id, log: ctx.log })
    const refill = await refillCardBuffer({ supabase: ctx.supabase, orgId: swipe.org_id, orgCardId: swipe.org_card_id, trigger: 'reactive', log: ctx.log })
    ctx.log.info('cards.lithic', 'buffer capture reconciled', { eventId: swipe.id, refilled: refill.ok })
    return ctx.json({ ok: true, settled: true, mode: 'buffer', refilled: refill.ok, refillReason: refill.ok ? undefined : refill.reason }, 200)
  }

  // Edge mode: a reversal doesn't touch the vault settle path (settleSpend only realizes on SETTLED).
  if (isReversal) return ctx.json({ ok: true, ignored: true, status }, 200)

  // Valve 1: off by default.
  if (process.env.LITHIC_AUTO_SETTLE_ENABLED !== 'true') {
    ctx.log.info('cards.lithic', 'capture received — auto-settle disabled, left for manual', { eventId: swipe.id })
    return ctx.json({ ok: true, settled: false, reason: 'auto_settle_disabled' }, 200)
  }

  // Valves 2 + 3 live in the shared core (maxAtomicUsdc = the $50 ceiling; core also hard-refuses ≥ $250).
  const outcome = await settleSwipeEvent({
    supabase: ctx.supabase, orgId: swipe.org_id, eventId: swipe.id, log: ctx.log,
    maxAtomicUsdc: autoSettleCeilingAtomic(),
  })

  if (outcome.ok) {
    ctx.log.info('cards.lithic', 'auto-settled capture', { eventId: swipe.id, txHash: outcome.txHash })
    return ctx.json({ ok: true, settled: true, txHash: outcome.txHash, explorerUrl: outcome.explorerUrl }, 200)
  }
  // Not settled (over the cap, disabled mid-flight, or a transient chain error). ACK 200 anyway so
  // Lithic won't retry-storm; the event stays unsettled and surfaces for a manual click.
  ctx.log.warn('cards.lithic', 'capture not auto-settled — left for manual', { eventId: swipe.id, reason: outcome.reason })
  return ctx.json({ ok: true, settled: false, reason: outcome.reason }, 200)
}, { auth: 'none' })

// Lithic Auth Stream Access (ASA) responder — the real-time "approve/decline this swipe" webhook.
// This is the missing front door onto the authorize leg already proven live (lib/proof/latestRun.ts
// leg 2): a real card swipe now reaches the SAME edge-auth NAV hold that leg exercised manually.
//
// Deliberately does NOT touch settlement. Capture/settle (burning shares via
// MintwarePaymentGateway.settleSpend) stays deploy-gated behind the relayer HTTP surface — same
// posture as /api/orgs/[id]/pay and the x402 /settle route (see .claude/rules/payments-ypn.md).
// This route only ever decides; nothing here moves money.
//
// Manual auth (auth: 'none' + hand verification), same category as wallet-link / vault deposit —
// see .claude/rules/route-handler.md "Routes That Do Manual Auth". Lithic signs with its own
// Standard-Webhooks scheme (webhook-id/-timestamp/-signature headers), not our EIP-191 flow.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { verifyAsaRequest, centsToAtomicUsdc } from '@/lib/cards/lithic'
import { decideCardSwipe } from '@/lib/org/cardAuthorize'

export const dynamic = 'force-dynamic'

/** Map our decline reasons onto Lithic's fixed ASA result enum (no generic "declined" code exists —
 *  https://docs.lithic.com/reference/cardauthorizationapprovalrequestwebhook). Chosen for the
 *  closest honest semantic fit, not to game merchant-facing messaging. */
function asaResultFor(reason: string): string {
  if (reason === 'over_role_daily_cap' || reason === 'over_per_tx_cap') return 'VELOCITY_EXCEEDED'
  if (reason === 'unknown_card' || reason === 'card_not_open' || reason === 'member_not_active') {
    return 'CARD_PAUSED'
  }
  // insufficient_equity, insufficient_buffer (card spend buffer), edge_unreachable,
  // edge_auth_unconfigured, edge_<status>, lookup failures, etc.
  return 'INSUFFICIENT_FUNDS'
}

export const POST = createHandler(async (req: NextRequest, ctx) => {
  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k] = v })

  const verified = verifyAsaRequest(rawBody, headers)
  if (!verified.ok) {
    if (verified.reason === 'unconfigured') {
      // Our own service isn't ready to authorize real swipes — 503, not a fake decline. Matches the
      // deploy-gated posture used everywhere else (x402 verify/settle, org pay).
      return ctx.json({ error: 'lithic_webhook_unconfigured' }, 503)
    }
    if (verified.reason === 'not_an_authorization_request') {
      // Some other ASA event type reached this endpoint (e.g. a challenge) — ack, do nothing.
      return ctx.json({ ok: true, ignored: true }, 200)
    }
    ctx.log.warn('cards.lithic', 'ASA signature verification failed')
    return ctx.json({ error: 'invalid_signature' }, 401)
  }

  const event = verified.event
  const cardToken = event.card?.token
  const amountCents = event.amounts?.cardholder?.amount ?? event.amount
  if (!cardToken || typeof amountCents !== 'number') {
    return ctx.json({ result: 'CARD_PAUSED' }, 200) // malformed event we can't safely route — decline
  }

  const startedAt = Date.now()
  const decision = await decideCardSwipe({
    supabase: ctx.supabase,
    provider: 'lithic',
    providerCardToken: cardToken,
    amountAtomicUsdc: centsToAtomicUsdc(amountCents),
    ref: event.token, // ASA event token — idempotent hold key, same role as the x402 nonce
  })
  const latencyMs = Date.now() - startedAt

  ctx.log.info('cards.lithic', 'ASA decision', {
    cardToken,
    amountCents,
    approved: decision.approved,
    reason: decision.approved ? undefined : decision.reason,
    latencyMs,
  })

  // Log every decision to the spend feed — but only when the card actually resolved to one of ours
  // (unknown_card/card_lookup_failed have no org_card_id to satisfy the FK; those are true "this
  // isn't our card" edge cases, not something the org's own feed needs to show).
  if (decision.orgCardId) {
    const { error: logErr } = await ctx.supabase.from('card_swipe_events').insert({
      org_id: decision.orgId,
      org_card_id: decision.orgCardId,
      member_wallet: decision.memberWallet,
      provider: 'lithic',
      provider_event_ref: event.token,
      amount_atomic_usdc: centsToAtomicUsdc(amountCents).toString(),
      merchant_descriptor: event.merchant?.descriptor ?? null,
      decision: decision.approved ? 'approved' : 'declined',
      decline_reason: decision.approved ? null : decision.reason,
      edge_hold_id: decision.approved ? (decision.holdId ?? null) : null,
      auth_mode: decision.approved ? (decision.mode ?? null) : null, // capture honors this (audit fix H2)
      latency_ms: latencyMs,
    })
    // Duplicate delivery (unique index) — prefer the SQL error CODE (23505) over a brittle message
    // substring (re-audit R9).
    const isDup = (logErr as { code?: string } | null)?.code === '23505' || !!logErr?.message?.includes('duplicate')
    if (logErr && isDup) {
      // decideCardSwipe ran again and, in buffer mode, reserved a SECOND hold for this same swipe (C1).
      // The original delivery already holds it — undo this call's double-reserve.
      if (decision.approved && decision.mode === 'buffer' && decision.orgCardId) {
        await ctx.supabase.rpc('release_card_buffer', {
          p_org_card_id: decision.orgCardId,
          p_amount: centsToAtomicUsdc(amountCents).toString(),
        })
      }
    } else if (logErr) {
      ctx.log.warn('cards.lithic', 'spend feed log failed', { error: logErr.message })
      // A NON-duplicate insert failure on a BUFFER approval orphans the reservation — there'd be no swipe
      // row for capture to ever release against (re-audit R2). FAIL CLOSED: release the hold and DECLINE,
      // rather than approve an untracked spend that leaks reserved_atomic forever.
      if (decision.approved && decision.mode === 'buffer' && decision.orgCardId) {
        await ctx.supabase.rpc('release_card_buffer', {
          p_org_card_id: decision.orgCardId,
          p_amount: centsToAtomicUsdc(amountCents).toString(),
        })
        return ctx.json({ result: asaResultFor('insufficient_buffer') }, 200)
      }
    }
  }

  if (decision.approved) return ctx.json({ result: 'APPROVED' }, 200)
  return ctx.json({ result: asaResultFor(decision.reason) }, 200)
}, { auth: 'none' })

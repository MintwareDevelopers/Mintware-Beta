// Bridge card webhook — the "spend, still earning" reconciler for the Bridge rail.
//
// Unlike the Lithic ASA route, we do NOT authorize here (Bridge does, at its own pull time). This route
// only reacts to POSTED movements: a spend resyncs the cached buffer balance from chain and tops it back
// up (Gateway.refillBuffer redeeming a vault slice); a refund resyncs only. All the decision logic is in
// lib/org/bridgeReconcile.ts; verification/normalization in lib/cards/bridgeClient.ts.
//
// Fail-closed + ack-200: 503 when the rail or webhook secret is unconfigured, 401 on a bad signature,
// 200 otherwise (so Bridge/Stripe doesn't retry-storm) — a skipped refill just stays skipped. Manual
// auth (Bridge signs with its own Stripe-style scheme), same category as the Lithic webhooks.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { bridgeCardsEnabled } from '@/lib/cards/bridge'
import { normalizeBridgeEvent, verifyBridgeWebhook } from '@/lib/cards/bridgeClient'
import { reconcileBridgeEvent } from '@/lib/org/bridgeReconcile'
import { syncBufferBalance } from '@/lib/org/bufferMonitor'
import { refillCardBuffer } from '@/lib/org/bufferRefill'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const POST = createHandler(async (req: NextRequest, ctx) => {
  if (!bridgeCardsEnabled()) return ctx.json({ error: 'bridge_rail_disabled' }, 503)

  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k] = v })

  const verified = verifyBridgeWebhook(rawBody, headers)
  if (!verified.ok) {
    if (verified.reason === 'unconfigured') return ctx.json({ error: 'bridge_webhook_unconfigured' }, 503)
    if (verified.reason === 'malformed') return ctx.json({ ok: true, ignored: true }, 200)
    ctx.log.warn('cards.bridge', 'webhook signature verification failed')
    return ctx.json({ error: 'invalid_signature' }, 401)
  }

  const parsed = normalizeBridgeEvent(verified.event)
  if (parsed.kind === 'ignore' || !parsed.providerCardId) {
    return ctx.json({ ok: true, ignored: true }, 200)
  }

  // Resolve the Bridge card id back to one of our cards.
  const { data: card } = await ctx.supabase
    .from('org_cards')
    .select('id, org_id')
    .eq('bridge_card_id', parsed.providerCardId)
    .maybeSingle()
  if (!card) {
    ctx.log.info('cards.bridge', 'event for an unknown card — ignored', { providerCardId: parsed.providerCardId })
    return ctx.json({ ok: true, ignored: true, reason: 'unknown_card' }, 200)
  }

  const result = await reconcileBridgeEvent(
    { kind: parsed.kind, orgCardId: card.id, amountAtomic: parsed.amountAtomic, eventId: parsed.eventId },
    {
      syncBuffer: async (orgCardId) => {
        await syncBufferBalance({ supabase: ctx.supabase, orgId: card.org_id, orgCardId, log: ctx.log })
      },
      refill: async (orgCardId) => {
        // reactive top-up; refillCardBuffer stays fail-closed behind CARD_BUFFER_REFILL_ENABLED.
        const r = await refillCardBuffer({ supabase: ctx.supabase, orgId: card.org_id, orgCardId, trigger: 'reactive', log: ctx.log })
        return r.ok ? { ok: true } : { ok: false, reason: r.reason }
      },
      log: (m, meta) => ctx.log.info('cards.bridge', m, meta),
    },
  )

  return ctx.json({ ok: true, ...result }, 200)
})

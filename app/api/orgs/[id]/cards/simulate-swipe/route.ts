// Simulate a swipe — fires a REAL Lithic sandbox ASA round-trip: Lithic calls our own webhook
// exactly as a live swipe would, edge-auth decides against real NAV, and the outcome lands in
// card_swipe_events a moment later. This route never decides anything itself — it only asks Lithic
// to originate the authorization request, same as a physical terminal would.
//
// Any active org member can trigger a simulation (it's a demo tool, not a spend action) — the PAN
// never leaves the server; it's read from org_cards server-side and handed straight to Lithic.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { simulateSwipe } from '@/lib/cards/lithic'
import { requireActiveCaller } from '@/lib/org/requireActiveCaller'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (r, ctx) => {
      const auth = await requireActiveCaller(ctx.supabase, ctx.user!.address, id)
      if ('error' in auth) return ctx.json({ error: auth.error }, auth.status)

      const body = await r.clone().json().catch(() => ({}))
      const cardId = String(body.cardId ?? '')
      const amountUsd = Number(body.amountUsd)
      const descriptor = String(body.merchantDescriptor ?? 'MINTWARE DEMO MERCHANT').slice(0, 25) // Lithic descriptor cap
      if (!cardId) return ctx.json({ error: 'cardId required' }, 400)
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) return ctx.json({ error: 'valid amountUsd required' }, 400)

      const { data: card } = await ctx.supabase
        .from('org_cards').select('sandbox_pan, provider, state').eq('id', cardId).eq('org_id', id).maybeSingle()
      if (!card) return ctx.json({ error: 'card not found' }, 404)
      if (card.provider !== 'lithic' || !card.sandbox_pan) return ctx.json({ error: 'card has no simulatable PAN (sandbox only)' }, 422)
      if (card.state !== 'OPEN') return ctx.json({ ok: true, note: 'card is not OPEN — expect a decline in the feed shortly' })

      try {
        const receipt = await simulateSwipe({
          pan: card.sandbox_pan,
          amountCents: Math.round(amountUsd * 100),
          merchantDescriptor: descriptor,
        })
        return ctx.json({ ok: true, receipt, note: 'Check the spend feed — the decision lands via the ASA webhook a moment after this call.' })
      } catch (e) {
        ctx.log.error('cards.lithic', 'simulate-swipe failed', { error: String(e) })
        return ctx.json({ ok: false, error: 'simulate_failed', detail: String(e) }, 502)
      }
    },
    { auth: 'signed-message', action: 'mintware-org-card-simulate-swipe' },
  )(req)
}

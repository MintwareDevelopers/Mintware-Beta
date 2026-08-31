// Card spend-buffer config — the user-controls surface (docs/developers/card-spend-buffer-spec.md §6).
//
// POST — create/update the OFF-CHAIN tuning knobs (enable, service level, per-tx cap, refill-rate cap,
//        sizing inputs, manual breaker). Signed-message auth: only the card MEMBER (whose capital funds
//        the buffer) or the org OWNER may configure it. This never moves money — it shapes future
//        refills, themselves bounded by the on-chain caps + the refill-rate breaker. The buffer_address
//        is NOT settable here (audit fix H1) — the monitor derives it from on-chain bufferOf[member].
//
// (An unauthenticated GET that returned the full row — member wallet, address, balances — was removed
//  as audit fix L2; a read surface can be re-added with proper auth when a UI needs it.)

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { parseBufferConfig } from '@/lib/cards/bufferConfig'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { id, cardId } = await params
  return createHandler(async (r, ctx) => {
    const caller = ctx.user!.address.toLowerCase()
    const body = await r.clone().json().catch(() => ({}))

    const parsed = parseBufferConfig(body)
    if (!parsed.ok) return ctx.json({ error: parsed.error }, 400)

    const { data: card } = await ctx.supabase
      .from('org_cards').select('id, org_id, member_wallet').eq('id', cardId).eq('org_id', id).maybeSingle()
    if (!card) return ctx.json({ error: 'card not found' }, 404)

    const { data: org } = await ctx.supabase
      .from('orgs').select('owner_wallet, treasury_chain_id').eq('id', id).single()
    if (!org?.treasury_chain_id) return ctx.json({ error: 'org treasury not set up yet' }, 409)

    // Only the card member (their capital) or the org owner may configure the buffer.
    const isMember = (card.member_wallet as string).toLowerCase() === caller
    const isOwner = (org.owner_wallet as string).toLowerCase() === caller
    if (!isMember && !isOwner) return ctx.json({ error: 'only the card member or org owner may configure this buffer' }, 403)

    const { error: upErr } = await ctx.supabase
      .from('card_spend_buffers')
      .upsert(
        {
          org_card_id: cardId,
          member_wallet: card.member_wallet,
          chain_id: org.treasury_chain_id,
          ...parsed.patch,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_card_id' },
      )
    if (upErr) return ctx.json({ error: 'config_write_failed', detail: upErr.message }, 500)

    return ctx.json({ ok: true, orgCardId: cardId, applied: parsed.patch })
  }, { auth: 'signed-message', action: 'mintware-card-buffer-config' })(req)
}

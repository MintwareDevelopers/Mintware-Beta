// Card spend-buffer config — the user-controls surface (docs/developers/card-spend-buffer-spec.md §6).
//
// GET  — read this card's buffer config + state + the freshly-computed target.
// POST — create/update the OFF-CHAIN tuning knobs (enable, service level, per-tx cap, refill-rate cap,
//        sizing inputs, manual breaker, and the registered buffer_address mirror). Signed-message auth:
//        only the card MEMBER (whose capital funds the buffer) or the org OWNER may configure it. This
//        never moves money — it shapes future refills, which are themselves bounded by the on-chain
//        caps (setBufferAddress / setUserDailyRefillCap) + the refill-rate breaker.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { parseBufferConfig } from '@/lib/cards/bufferConfig'
import { bufferTargetAtomic } from '@/lib/cards/bufferSizing'

export const dynamic = 'force-dynamic'

const big = (v: unknown) => { try { return BigInt(String(v ?? '0')) } catch { return 0n } }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { id, cardId } = await params
  return createHandler(async (_r, ctx) => {
    const { data: buf } = await ctx.supabase
      .from('card_spend_buffers').select('*').eq('org_card_id', cardId).maybeSingle()
    if (!buf) return ctx.json({ configured: false, orgId: id, orgCardId: cardId })
    const target = bufferTargetAtomic({
      meanDemandLeadTimeAtomic: big(buf.mean_demand_leadtime_atomic),
      demandStdevAtomic: big(buf.demand_stdev_atomic),
      sigmaPeriodSecs: Number(buf.sigma_period_secs),
      leadTimeSecs: Number(buf.lead_time_secs),
      serviceLevelBps: Number(buf.service_level_bps),
    })
    return ctx.json({ configured: true, buffer: buf, computedTargetAtomic: target.toString() })
  })(req)
}

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

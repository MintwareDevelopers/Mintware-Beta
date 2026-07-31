// POST /api/agents/campaigns/create
// Mirrors an already-created on-chain agent volume campaign.
// Auth: Bearer AI_ATTRIBUTION_ORACLE_SECRET — oracle/server-only. (The handler does NOT verify
// campaignId on-chain, so this must not be public: attacker-controlled name/target/protocol
// would otherwise be writable to ai_volume_campaigns. Matches the sibling `record` route.)

import { createHandler } from '@/lib/web2/routeHandler'
import { AI_ATTRIBUTION_ORACLE_SECRET } from '@/lib/constants'

export const POST = createHandler(async (req, ctx) => {
  let body: { campaignId?: number; protocolAddress?: string; name?: string; targetVolume?: string; durationDays?: number }
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'invalid json' }, 400) }

  if (!body.campaignId || body.campaignId < 1) return ctx.json({ error: 'campaignId required' }, 400)
  const protocol = body.protocolAddress?.toLowerCase()
  if (!protocol || !/^0x[0-9a-f]{40}$/.test(protocol)) return ctx.json({ error: 'invalid protocolAddress' }, 400)
  if (!body.name?.trim())    return ctx.json({ error: 'name required' }, 400)
  if (!body.targetVolume)    return ctx.json({ error: 'targetVolume required' }, 400)
  if (!body.durationDays || body.durationDays < 1) return ctx.json({ error: 'durationDays must be >= 1' }, 400)

  const now     = new Date()
  const endTime = new Date(now.getTime() + body.durationDays * 86_400_000)

  const { data, error } = await ctx.supabase
    .from('ai_volume_campaigns')
    .upsert(
      { campaign_id: body.campaignId, protocol_address: protocol, name: body.name.trim(), target_volume: body.targetVolume, start_time: now.toISOString(), end_time: endTime.toISOString(), active: true },
      { onConflict: 'campaign_id' }
    )
    .select().single()

  if (error) {
    ctx.log.error('agents/campaigns/create', 'failed to create campaign', { error: error.message })
    return ctx.json({ error: 'failed to create campaign' }, 500)
  }

  return ctx.json({ ok: true, campaign: data }, 201)
}, { auth: 'bearer-token', bearerSecret: AI_ATTRIBUTION_ORACLE_SECRET })

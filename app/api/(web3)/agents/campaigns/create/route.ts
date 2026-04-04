// =============================================================================
// POST /api/agents/campaigns/create — mirror an already-created on-chain agent volume campaign
//
// This route is not the source of truth for campaign ids. The contract owns
// `campaignCount`, so callers must provide the real on-chain `campaignId`
// rather than having the API guess one from row count.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function POST(req: NextRequest) {
  let body: {
    campaignId?:      number
    protocolAddress?: string
    name?:            string
    targetVolume?:    string   // in ETH (string to avoid precision loss)
    durationDays?:    number
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  if (!body.campaignId || body.campaignId < 1) {
    return NextResponse.json({ error: 'campaignId required' }, { status: 400 })
  }
  const protocol = body.protocolAddress?.toLowerCase()
  if (!protocol || !/^0x[0-9a-f]{40}$/.test(protocol)) {
    return NextResponse.json({ error: 'invalid protocolAddress' }, { status: 400 })
  }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!body.targetVolume)  return NextResponse.json({ error: 'targetVolume required' }, { status: 400 })
  if (!body.durationDays || body.durationDays < 1) {
    return NextResponse.json({ error: 'durationDays must be >= 1' }, { status: 400 })
  }

  const supabase  = createSupabaseServiceClient()
  const now       = new Date()
  const endTime   = new Date(now.getTime() + body.durationDays * 86_400_000)

  const { data, error } = await supabase
    .from('ai_volume_campaigns')
    .upsert(
      {
        campaign_id:      body.campaignId,
        protocol_address: protocol,
        name:             body.name.trim(),
        target_volume:    body.targetVolume,
        start_time:       now.toISOString(),
        end_time:         endTime.toISOString(),
        active:           true,
      },
      { onConflict: 'campaign_id' }
    )
    .select()
    .single()

  if (error) {
    console.error('[POST /api/agents/campaigns/create]', error.message)
    return NextResponse.json({ error: 'failed to create campaign' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, campaign: data }, { status: 201 })
}

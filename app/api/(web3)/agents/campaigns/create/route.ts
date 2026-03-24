// =============================================================================
// POST /api/agents/campaigns/create — create a new agent volume campaign
// Permissionless — any wallet can create a campaign.
// Mirrors createVolumeCampaign() in AIAttribution.sol.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function POST(req: NextRequest) {
  let body: {
    protocolAddress?: string
    name?:            string
    targetVolume?:    string   // in ETH (string to avoid precision loss)
    durationDays?:    number
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

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

  // Get next campaign_id (mirrors on-chain campaignCount++)
  const { count } = await supabase
    .from('ai_volume_campaigns').select('*', { count: 'exact', head: true })
  const campaignId = (count ?? 0) + 1

  const { data, error } = await supabase
    .from('ai_volume_campaigns')
    .insert({
      campaign_id:      campaignId,
      protocol_address: protocol,
      name:             body.name.trim(),
      target_volume:    body.targetVolume,
      start_time:       now.toISOString(),
      end_time:         endTime.toISOString(),
      active:           true,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/agents/campaigns/create]', error.message)
    return NextResponse.json({ error: 'failed to create campaign' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, campaign: data }, { status: 201 })
}

// =============================================================================
// GET /api/campaigns/participant?campaign_id=&address=
//
// Checks whether a wallet has joined a campaign by querying the Supabase
// `participants` table (written by /api/campaigns/join).
//
// This endpoint exists because the Attribution Worker (/campaign?id=&address=)
// always returns participant: null — it has no access to our Supabase tables.
// The campaign detail page uses this to hydrate `isJoined` state on mount
// so the "joined" UI survives a page refresh.
//
// Response:
//   200 { joined: true,  wallet, campaign_id, attribution_score, total_points, joined_at }
//   200 { joined: false, wallet, campaign_id }
//   400 Missing required params
//   500 Supabase error
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const campaignId = searchParams.get('campaign_id')
  const rawAddress = searchParams.get('address')

  if (!campaignId || !rawAddress) {
    return NextResponse.json(
      { error: 'campaign_id and address are required' },
      { status: 400 }
    )
  }

  if (!ETH_ADDRESS_RE.test(rawAddress)) {
    return NextResponse.json(
      { error: 'invalid wallet address' },
      { status: 400 }
    )
  }

  const wallet = rawAddress.toLowerCase()
  const supabase = createSupabaseServiceClient()

  const { data, error } = await supabase
    .from('participants')
    .select('wallet, campaign_id, attribution_score, total_points, joined_at')
    .eq('campaign_id', campaignId)
    .eq('wallet', wallet)
    .maybeSingle()

  if (error) {
    console.error('[participant] Supabase error:', error.message)
    return NextResponse.json(
      { error: 'Failed to check participant status' },
      { status: 500 }
    )
  }

  if (!data) {
    return NextResponse.json({ joined: false, wallet, campaign_id: campaignId })
  }

  return NextResponse.json({
    joined:             true,
    wallet:             data.wallet,
    campaign_id:        data.campaign_id,
    attribution_score:  data.attribution_score,
    total_points:       data.total_points,
    joined_at:          data.joined_at,
  })
}

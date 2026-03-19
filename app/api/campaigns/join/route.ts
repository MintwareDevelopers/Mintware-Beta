// =============================================================================
// POST /api/campaigns/join
//
// Registers a wallet as a participant in a campaign.
// Replaces the external Worker /join endpoint which was returning "Invalid wallet".
//
// Flow:
//   1. Validate inputs
//   2. Load campaign, check it's live
//   3. Fetch user's Attribution score from Worker API
//   4. Check min_score gate
//   5. Upsert participant row (idempotent — safe to call twice)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient }  from '@/lib/supabase'
import { API } from '@/lib/api'

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { campaign_id, address } = (body ?? {}) as Record<string, unknown>

  if (typeof campaign_id !== 'string' || !campaign_id) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 422 })
  }
  if (typeof address !== 'string' || !ETH_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'invalid wallet address' }, { status: 422 })
  }

  const wallet = address.toLowerCase()
  const supabase = createSupabaseServiceClient()

  // 1. Load campaign
  const { data: campaign, error: campaignErr } = await supabase
    .from('campaigns')
    .select('id, status, min_score, campaign_type')
    .eq('id', campaign_id)
    .single()

  if (campaignErr || !campaign) {
    return NextResponse.json({ error: 'campaign not found' }, { status: 404 })
  }
  if (campaign.status !== 'live' && campaign.status !== 'upcoming') {
    return NextResponse.json({ error: 'campaign is not accepting participants' }, { status: 409 })
  }

  // 2. Fetch Attribution score (non-blocking — default 0 if API is down)
  let attribution_score = 0
  try {
    const scoreRes = await fetch(`${API}/score?address=${encodeURIComponent(address)}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (scoreRes.ok) {
      const scoreData = await scoreRes.json()
      attribution_score = typeof scoreData.score === 'number' ? scoreData.score : 0
    }
  } catch {
    // Score API unavailable — allow join with score 0, worker will refresh later
  }

  // 3. min_score gate (points campaigns only — token_pool is open access)
  const minScore = campaign.min_score ?? 0
  if (campaign.campaign_type === 'points' && minScore > 0 && attribution_score < minScore) {
    return NextResponse.json(
      { error: `Score too low. Required: ${minScore}, yours: ${attribution_score}` },
      { status: 403 }
    )
  }

  // 4. Upsert participant — idempotent, safe to call multiple times
  const { error: upsertErr } = await supabase
    .from('participants')
    .upsert(
      {
        campaign_id,
        wallet,
        attribution_score,
        sharing_score:    0,
        total_points:     0,
        total_earned_usd: 0,
        joined_at:        new Date().toISOString(),
      },
      { onConflict: 'campaign_id,wallet', ignoreDuplicates: true }
    )

  if (upsertErr) {
    console.error('[join] upsert error:', upsertErr)
    return NextResponse.json({ error: 'failed to join campaign' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, campaign_id, wallet, attribution_score })
}

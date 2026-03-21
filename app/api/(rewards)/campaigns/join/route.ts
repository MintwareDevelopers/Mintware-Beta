// =============================================================================
// POST /api/campaigns/join
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { API } from '@/lib/web2/api'

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/** Fetch with a manual timeout — AbortSignal.timeout not reliable on all runtimes */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

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

  let supabase: ReturnType<typeof createSupabaseServiceClient>
  try {
    supabase = createSupabaseServiceClient()
  } catch (e) {
    console.error('[join] supabase init error:', e)
    return NextResponse.json({ error: 'server configuration error' }, { status: 500 })
  }

  // 1. Load campaign
  const { data: campaign, error: campaignErr } = await supabase
    .from('campaigns')
    .select('id, status, min_score, campaign_type')
    .eq('id', campaign_id)
    .single()

  if (campaignErr) {
    console.error('[join] campaign query error:', campaignErr)
    return NextResponse.json({ error: `campaign lookup failed: ${campaignErr.message}` }, { status: 500 })
  }
  if (!campaign) {
    return NextResponse.json({ error: 'campaign not found' }, { status: 404 })
  }
  if (campaign.status !== 'live' && campaign.status !== 'upcoming') {
    return NextResponse.json({ error: 'campaign is not accepting participants' }, { status: 409 })
  }

  // 2. Fetch Attribution score — 4s timeout, default 0 on failure
  let attribution_score = 0
  try {
    const scoreRes = await fetchWithTimeout(
      `${API}/score?address=${encodeURIComponent(address)}`,
      4000
    )
    if (scoreRes.ok) {
      const scoreData = await scoreRes.json()
      attribution_score = typeof scoreData.score === 'number' ? scoreData.score : 0
    }
  } catch (e) {
    // Timeout or network error — allow join with score 0
    console.warn('[join] score fetch failed, defaulting to 0:', e instanceof Error ? e.message : e)
  }

  // 3. min_score gate (points campaigns only — token_pool is open)
  const minScore = Number(campaign.min_score ?? 0)
  if (campaign.campaign_type === 'points' && minScore > 0 && attribution_score < minScore) {
    return NextResponse.json(
      { error: `Score too low. Required: ${minScore}, yours: ${attribution_score}` },
      { status: 403 }
    )
  }

  // 4. Upsert participant
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
    return NextResponse.json({ error: `join failed: ${upsertErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, campaign_id, wallet, attribution_score })
}

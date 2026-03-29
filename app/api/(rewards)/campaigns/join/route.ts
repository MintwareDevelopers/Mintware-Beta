// =============================================================================
// POST /api/campaigns/join
//
// Phase 6 update: accepts Solana (base58) wallets in addition to EVM (0x).
// Uses getCombinedAttributionScore() so a linked wallet pair gets credit for
// the stronger score at join time.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient }   from '@/lib/web2/supabase'
import { getCombinedAttributionScore }   from '@/lib/rewards/combinedScore'

const EVM_RE    = /^0x[0-9a-fA-F]{40}$/
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function isValidAddress(addr: string): boolean {
  return EVM_RE.test(addr) || SOLANA_RE.test(addr)
}

/** Preserve case for Solana; lowercase EVM */
function normalizeWallet(addr: string): string {
  return EVM_RE.test(addr) ? addr.toLowerCase() : addr
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
  if (typeof address !== 'string' || !isValidAddress(address)) {
    return NextResponse.json(
      { error: 'invalid wallet address — must be EVM (0x...) or Solana (base58)' },
      { status: 422 }
    )
  }

  const wallet = normalizeWallet(address)

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

  // 2. Fetch combined Attribution score (EVM + linked Solana, or Solana + linked EVM)
  //    Falls back gracefully to 0 on any error — never blocks a join.
  let attribution_score = 0
  try {
    attribution_score = await getCombinedAttributionScore(wallet, supabase)
  } catch (e) {
    console.warn('[join] score fetch failed, defaulting to 0:', e instanceof Error ? e.message : e)
  }

  // 3. min_score gate (points campaigns only — token_pool is open access)
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

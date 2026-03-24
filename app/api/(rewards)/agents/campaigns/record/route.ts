// =============================================================================
// POST /api/agents/campaigns/record — oracle-gated action recording
//
// Called by the oracle (onchainPublisher.ts pattern) after verifying an
// on-chain action. Mirrors recordVerifiedAction() in AIAttribution.sol.
//
// Auth: Bearer token must match AI_ATTRIBUTION_ORACLE_SECRET env var.
// Rate limit: handled by middleware.ts (10 req/min per IP).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

const ORACLE_SECRET = process.env.AI_ATTRIBUTION_ORACLE_SECRET

export async function POST(req: NextRequest) {
  // ── Oracle auth ────────────────────────────────────────────────────────────
  const auth = req.headers.get('authorization')
  if (!ORACLE_SECRET || auth !== `Bearer ${ORACLE_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: {
    address?:         string
    volumeWei?:       string   // raw wei as string (avoids JS number precision issues)
    mwpHash?:         string
    campaignId?:      number
    txHash?:          string
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const address    = body.address?.toLowerCase()
  const volumeWei  = BigInt(body.volumeWei ?? '0')
  const mwpHash    = body.mwpHash?.toLowerCase() ?? null
  const campaignId = body.campaignId ?? 0

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  // Check agent is registered
  const { data: profile } = await supabase
    .from('ai_agent_profiles')
    .select('address')
    .eq('address', address)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json({ error: 'agent not registered' }, { status: 404 })
  }

  // ── Update behavior score ─────────────────────────────────────────────────
  const behaviorDelta = Number(volumeWei / BigInt(1e18))

  const { data: score } = await supabase
    .from('ai_agent_scores')
    .select('behavior, interpretability, mwp_submissions')
    .eq('address', address)
    .maybeSingle()

  const updates: Record<string, unknown> = {
    behavior: (Number(score?.behavior ?? 0) + behaviorDelta),
  }

  // ── MWP hash bonus ────────────────────────────────────────────────────────
  if (mwpHash && /^0x[0-9a-f]{64}$/.test(mwpHash)) {
    const { data: existing } = await supabase
      .from('ai_agent_mwp_hashes')
      .select('id')
      .eq('address', address)
      .eq('mwp_hash', mwpHash)
      .maybeSingle()

    if (!existing) {
      const currentInterp = Number(score?.interpretability ?? 0)
      const bonus         = Math.min(50, Math.max(0, 500 - currentInterp))
      updates.interpretability = currentInterp + bonus
      updates.mwp_submissions  = (score?.mwp_submissions ?? 0) + 1
      updates.is_transparent   = true
      updates.last_mwp_hash    = mwpHash

      await supabase.from('ai_agent_mwp_hashes').insert({ address, mwp_hash: mwpHash })
    }
  }

  await supabase.from('ai_agent_scores').update(updates).eq('address', address)

  // ── Campaign volume ───────────────────────────────────────────────────────
  if (campaignId > 0) {
    const { data: existing } = await supabase
      .from('ai_campaign_volume')
      .select('volume_wei')
      .eq('campaign_id', campaignId)
      .eq('address', address)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('ai_campaign_volume')
        .update({ volume_wei: (BigInt(existing.volume_wei ?? '0') + volumeWei).toString() })
        .eq('campaign_id', campaignId)
        .eq('address', address)
    } else {
      await supabase
        .from('ai_campaign_volume')
        .insert({ campaign_id: campaignId, address, volume_wei: volumeWei.toString() })
    }
  }

  return NextResponse.json({ ok: true, address, behaviorDelta, campaignId })
}

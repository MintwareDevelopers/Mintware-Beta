// =============================================================================
// GET  /api/campaigns/manage?campaign_id=&wallet=
// POST /api/campaigns/manage
//      Body: { campaign_id, action: 'pause'|'resume'|'end', wallet }
//
// GET — Returns full campaign dashboard data for the creator.
//   Verifies wallet === campaign.creator → 403 if mismatch.
//   Returns:
//     { campaign, stats, top_referrers?, recent_txs?, leaderboard?, epoch_history? }
//
//   stats shape:
//     { pool_remaining_usd, participant_count, total_volume_usd,
//       total_paid_out_usd, days_remaining }
//
//   top_referrers  — token_pool campaigns only (top 5 by earned)
//   recent_txs     — token_pool campaigns only (last 10)
//   leaderboard    — points campaigns only (top 10 by total_points)
//   epoch_history  — points campaigns only (distributions, last 20)
//
// POST — Pause / resume / end a campaign.
//   Verifies wallet === campaign.creator → 403 if mismatch.
//   Updates campaigns.status and returns { success: true, status: new_status }.
//
// Auth: wallet param/body field is checked against campaign.creator.
//       Uses service role for all DB operations.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { daysUntil } from '@/lib/web2/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

// ---------------------------------------------------------------------------
// GET — fetch full manage dashboard
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const campaignId = searchParams.get('campaign_id')
  const rawWallet  = searchParams.get('wallet')

  if (!campaignId || !rawWallet) {
    return NextResponse.json(
      { error: 'campaign_id and wallet are required' },
      { status: 400 }
    )
  }
  if (!isValidAddress(rawWallet)) {
    return NextResponse.json(
      { error: 'invalid wallet address' },
      { status: 400 }
    )
  }

  const wallet   = rawWallet.toLowerCase()
  const supabase = createSupabaseServiceClient()

  // -- Fetch campaign --------------------------------------------------------
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single()

  if (campErr || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // -- Creator guard ---------------------------------------------------------
  if (!campaign.creator || campaign.creator.toLowerCase() !== wallet) {
    return NextResponse.json(
      { error: 'Access denied — you are not the creator of this campaign' },
      { status: 403 }
    )
  }

  // -- Stats: participant count ----------------------------------------------
  const { count: participantCount } = await supabase
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)

  // -- Stats: total volume (sum of amount_usd from activity) -----------------
  const { data: volumeData } = await supabase
    .from('activity')
    .select('amount_usd')
    .eq('campaign_id', campaignId)
    .not('amount_usd', 'is', null)

  const totalVolumeUsd = (volumeData ?? []).reduce(
    (sum, row) => sum + (row.amount_usd ?? 0), 0
  )

  // -- Stats: total paid out (sum of reward_usd from pending_rewards claimed) -
  const { data: paidData } = await supabase
    .from('pending_rewards')
    .select('reward_usd')
    .eq('campaign_id', campaignId)
    .eq('status', 'claimed')

  const totalPaidOutUsd = (paidData ?? []).reduce(
    (sum, row) => sum + (row.reward_usd ?? 0), 0
  )

  // -- Days remaining --------------------------------------------------------
  const daysRemaining = campaign.end_date ? daysUntil(campaign.end_date) : null

  const stats = {
    pool_remaining_usd: campaign.pool_remaining_usd ?? campaign.pool_usd ?? null,
    participant_count:  participantCount ?? 0,
    total_volume_usd:   Math.round(totalVolumeUsd * 100) / 100,
    total_paid_out_usd: Math.round(totalPaidOutUsd * 100) / 100,
    days_remaining:     daysRemaining,
  }

  // -- Token pool: top referrers (top 5) -------------------------------------
  let top_referrers: object[] | undefined
  let recent_txs: object[] | undefined

  if (campaign.campaign_type === 'token_pool') {
    const { data: refData } = await supabase
      .from('pending_rewards')
      .select('referrer, reward_usd, wallet')
      .eq('campaign_id', campaignId)
      .eq('reward_type', 'referrer')
      .not('referrer', 'is', null)

    if (refData && refData.length > 0) {
      // Group by referrer
      const refMap = new Map<string, { wallet: string; referred: Set<string>; earned: number }>()
      for (const row of refData) {
        const ref = row.referrer as string
        if (!refMap.has(ref)) refMap.set(ref, { wallet: ref, referred: new Set(), earned: 0 })
        const entry = refMap.get(ref)!
        entry.referred.add(row.wallet as string)
        entry.earned += row.reward_usd ?? 0
      }
      top_referrers = Array.from(refMap.values())
        .map(r => ({ wallet: r.wallet, referred: r.referred.size, earned: Math.round(r.earned * 100) / 100 }))
        .sort((a, b) => b.earned - a.earned)
        .slice(0, 5)
    } else {
      top_referrers = []
    }

    // Recent transactions (last 10 buy activity rows)
    const { data: txData } = await supabase
      .from('activity')
      .select('recorded_at, wallet, amount_usd, tx_hash')
      .eq('campaign_id', campaignId)
      .eq('action_type', 'trade')
      .order('recorded_at', { ascending: false })
      .limit(10)

    recent_txs = (txData ?? []).map(row => ({
      time:      row.recorded_at,
      wallet:    row.wallet,
      amount_usd: row.amount_usd ?? 0,
      tx_hash:   row.tx_hash,
    }))
  }

  // -- Points: leaderboard (top 10) -----------------------------------------
  let leaderboard: object[] | undefined
  let epoch_history: object[] | undefined

  if (campaign.campaign_type === 'points') {
    const { data: lbData } = await supabase
      .from('participants')
      .select('wallet, total_points, total_earned_usd')
      .eq('campaign_id', campaignId)
      .order('total_points', { ascending: false })
      .limit(10)

    // Compute estimated payout per wallet based on share of total points
    const totalPts = (lbData ?? []).reduce((s, r) => s + (r.total_points ?? 0), 0)
    const epochPool = campaign.pool_usd ?? 0
    // Rough epoch count: days remaining / 1 (daily epochs) — simplification
    const epochCount = Math.max(1, daysRemaining ?? 1)
    const perEpochPool = totalPts > 0 ? epochPool / epochCount : 0

    leaderboard = (lbData ?? []).map((row, i) => ({
      rank: i + 1,
      wallet: row.wallet,
      points: row.total_points ?? 0,
      est_payout: totalPts > 0
        ? Math.round((perEpochPool * ((row.total_points ?? 0) / totalPts)) * 100) / 100
        : 0,
    }))

    // Epoch history (last 20 distributions)
    const { data: distData } = await supabase
      .from('distributions')
      .select('epoch_number, published_at, status, onchain_id')
      .eq('campaign_id', campaignId)
      .order('epoch_number', { ascending: false })
      .limit(20)

    // For each distribution, get participant count and paid out
    epoch_history = await Promise.all(
      (distData ?? []).map(async (dist) => {
        const { count } = await supabase
          .from('daily_payouts')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId)
          .eq('epoch_number', dist.epoch_number)

        const { data: payoutSum } = await supabase
          .from('daily_payouts')
          .select('payout_usd')
          .eq('campaign_id', campaignId)
          .eq('epoch_number', dist.epoch_number)

        const paid_out = (payoutSum ?? []).reduce((s, r) => s + (r.payout_usd ?? 0), 0)

        return {
          epoch_number:  dist.epoch_number,
          date:          dist.published_at,
          participants:  count ?? 0,
          paid_out_usd:  Math.round(paid_out * 100) / 100,
          status:        dist.status,
        }
      })
    )
  }

  return NextResponse.json({
    campaign,
    stats,
    ...(top_referrers !== undefined && { top_referrers }),
    ...(recent_txs    !== undefined && { recent_txs }),
    ...(leaderboard   !== undefined && { leaderboard }),
    ...(epoch_history !== undefined && { epoch_history }),
  })
}

// ---------------------------------------------------------------------------
// POST — pause / resume / end
// ---------------------------------------------------------------------------
const STATUS_MAP: Record<string, string> = {
  pause:  'paused',
  resume: 'live',
  end:    'ended',
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { campaign_id, action, wallet } = body as Record<string, string>

  if (!campaign_id || !action || !wallet) {
    return NextResponse.json(
      { error: 'campaign_id, action, and wallet are required' },
      { status: 400 }
    )
  }
  if (!isValidAddress(wallet)) {
    return NextResponse.json({ error: 'invalid wallet address' }, { status: 400 })
  }
  if (!STATUS_MAP[action]) {
    return NextResponse.json(
      { error: 'action must be one of: pause | resume | end' },
      { status: 400 }
    )
  }

  const normalWallet = wallet.toLowerCase()
  const newStatus    = STATUS_MAP[action]
  const supabase     = createSupabaseServiceClient()

  // -- Verify creator --------------------------------------------------------
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, creator, status')
    .eq('id', campaign_id)
    .single()

  if (campErr || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }
  if (!campaign.creator || campaign.creator.toLowerCase() !== normalWallet) {
    return NextResponse.json(
      { error: 'Access denied — you are not the creator of this campaign' },
      { status: 403 }
    )
  }

  // -- Guard: can't resume/pause an ended campaign ---------------------------
  if (campaign.status === 'ended' && action !== 'end') {
    return NextResponse.json(
      { error: 'Campaign has already ended and cannot be changed' },
      { status: 409 }
    )
  }

  // -- Apply status change ---------------------------------------------------
  const { error: updateErr } = await supabase
    .from('campaigns')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', campaign_id)

  if (updateErr) {
    console.error('[campaigns/manage] update error:', updateErr)
    return NextResponse.json({ error: 'Failed to update campaign status' }, { status: 500 })
  }

  return NextResponse.json({ success: true, status: newStatus })
}

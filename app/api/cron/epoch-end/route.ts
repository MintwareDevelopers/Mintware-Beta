// =============================================================================
// app/api/cron/epoch-end/route.ts — Daily epoch payout cron handler
//
// Triggered by Vercel cron at 00:00 UTC daily (see vercel.json).
// Protected by Authorization: Bearer <CRON_SECRET> header.
//
// Flow:
//   1. Verify CRON_SECRET
//   2. Load all live campaigns from Supabase
//   3. For each live campaign:
//      a. Load all participants
//      b. Run epochProcessor.processEpoch()
//      c. Write payout records to campaign_payouts table
//      d. Update total_earned_usd on each participant row
//      e. Reset daily_volume_usd to 0 for all participants
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }        from '@supabase/ssr'
import { processEpoch, todayUTC }    from '@/lib/campaigns/epochProcessor'
import type { Campaign }             from '@/lib/campaigns/types'
import type { ParticipantRow }       from '@/lib/campaigns/epochProcessor'

// ─── Supabase service-role client ─────────────────────────────────────────────

function makeServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } },
  )
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase  = makeServiceClient()
  const epochDate = todayUTC()
  const results:  unknown[] = []
  const errors:   { campaignId: string; error: string }[] = []

  // ── Load live campaigns ────────────────────────────────────────────────────
  const { data: campaigns, error: campErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'live')

  if (campErr) {
    return NextResponse.json({ error: campErr.message }, { status: 500 })
  }

  for (const campaign of (campaigns ?? []) as Campaign[]) {
    try {
      await processCampaignEpoch(supabase, campaign, epochDate, results)
    } catch (e) {
      errors.push({ campaignId: campaign.id, error: (e as Error).message })
    }
  }

  return NextResponse.json({
    epochDate,
    processed: results.length,
    errors:    errors.length,
    results,
    ...(errors.length > 0 ? { errorDetails: errors } : {}),
  })
}

// ─── Per-campaign epoch handler ────────────────────────────────────────────────

type ServiceClient = ReturnType<typeof makeServiceClient>

async function processCampaignEpoch(
  supabase:   ServiceClient,
  campaign:   Campaign,
  epochDate:  string,
  results:    unknown[],
) {
  // ── Idempotency guard — skip if already processed today ──────────────────
  const { data: existingEpoch } = await supabase
    .from('epoch_state')
    .select('processed_at')
    .eq('campaign_id', campaign.id)
    .eq('epoch_date', epochDate)
    .maybeSingle()

  if (existingEpoch) {
    results.push({ campaignId: campaign.id, epochDate, skipped: true, reason: 'already processed', processedAt: existingEpoch.processed_at })
    return
  }

  // Load participants
  const { data: rows, error: partErr } = await supabase
    .from('participants')
    .select([
      'wallet',
      'observer',
      'total_points',
      'trading_points',
      'bridge_points',
      'daily_volume_usd',
      'joined_at',
      'attribution_score',
      'score_multiplier',
      'referred_by',
      'referral_trade_points',
      'referral_bridge_points',
    ].join(','))
    .eq('campaign_id', campaign.id)

  if (partErr) throw new Error(`load participants: ${partErr.message}`)
  if (!rows || rows.length === 0) return

  const participants = rows as unknown as ParticipantRow[]

  // Compute daily budget: daily_payout_usd from campaign, or pool / duration
  const dailyBudget = campaign.daily_payout_usd ?? 0

  if (dailyBudget <= 0) return

  // Run epoch processor
  const result = processEpoch(campaign, participants, dailyBudget, epochDate)

  if (result.payouts.length === 0) {
    results.push({ campaignId: campaign.id, epochDate, skipped: true, reason: 'no qualifiers' })
    await resetDailyVolume(supabase, campaign.id, (rows as unknown as ParticipantRow[]).map(r => r.wallet))
    return
  }

  // Write payout records
  const payoutInserts = result.payouts.map(p => ({
    campaign_id:  campaign.id,
    wallet:       p.wallet,
    epoch_date:   epochDate,
    rank:         p.rank,
    points:       p.points,
    amount_usd:   p.amount_usd,
    type:         p.type,
  }))

  const { error: insertErr } = await supabase
    .from('campaign_payouts')
    .upsert(payoutInserts, { onConflict: 'campaign_id,wallet,epoch_date,type' })

  if (insertErr) throw new Error(`insert payouts: ${insertErr.message}`)

  // Update total_earned_usd for each paid wallet
  for (const payout of result.payouts) {
    const { error: updateErr } = await supabase.rpc('increment_earned_usd', {
      p_campaign_id: campaign.id,
      p_wallet:      payout.wallet,
      p_amount:      payout.amount_usd,
    })
    if (updateErr) {
      // Non-fatal — log and continue so other payouts still land
      console.error(`increment_earned_usd for ${payout.wallet}:`, updateErr.message)
    }
  }

  // Reset daily_volume_usd for all participants
  await resetDailyVolume(supabase, campaign.id, (rows as unknown as ParticipantRow[]).map(r => r.wallet))

  // Record epoch completion for idempotency
  const { error: epochInsertErr } = await supabase
    .from('epoch_state')
    .insert({
      campaign_id:       campaign.id,
      epoch_date:        epochDate,
      participant_count: participants.length,
      total_points:      result.payouts.reduce((s, p) => s + p.points, 0),
      total_payout_usd:  result.totalPaidUsd,
    })

  if (epochInsertErr) {
    // Non-fatal: epoch_state is a guard, not the canonical payout record
    console.error(`epoch_state insert for ${campaign.id}:`, epochInsertErr.message)
  }

  results.push(result)
}

// ─── Reset daily volume ────────────────────────────────────────────────────────

async function resetDailyVolume(
  supabase:   ServiceClient,
  campaignId: string,
  wallets:    string[],
) {
  // Batch reset in chunks of 200 to stay within Supabase row limits
  const CHUNK = 200
  for (let i = 0; i < wallets.length; i += CHUNK) {
    const chunk = wallets.slice(i, i + CHUNK)
    await supabase
      .from('participants')
      .update({ daily_volume_usd: 0 })
      .eq('campaign_id', campaignId)
      .in('wallet', chunk)
  }
}

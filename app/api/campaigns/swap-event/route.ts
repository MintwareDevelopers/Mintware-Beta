// =============================================================================
// app/api/campaigns/swap-event/route.ts
//
// Receives swap/bridge events from an on-chain indexer or hook callback,
// credits points to the relevant campaign participants, and records the
// event in the activity table for deduplication.
//
// Auth:
//   - Requests with x-webhook-secret matching WEBHOOK_SECRET env are accepted
//   - Requests from localhost (127.0.0.1 / ::1) are accepted without auth (dev)
//   - If WEBHOOK_SECRET is unset, all requests are accepted (dev fallback)
//
// Deduplication:
//   - tx_hash is checked against the activity table before processing
//   - Duplicate tx_hash returns { success: true, credited: 0, skipped: true }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }        from '@supabase/ssr'
import {
  computeSwapPoints,
  computeReferralPoints,
  buildParticipantIncrement,
} from '@/lib/campaigns/swapHook'
import type { Campaign, SwapEventInput } from '@/lib/campaigns/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SwapPayload {
  wallet:      string
  tx_hash:     string
  chain:       string
  token_in:    string
  token_out:   string
  amount_usd:  number
  timestamp:   string    // ISO 8601
  campaign_id?: string   // optional — if omitted, resolves via DB
  is_bridge?:  boolean   // optional — defaults false; set true for bridge events
}

interface ParticipantRecord {
  campaign_id:             string
  observer:                boolean
  referred_by?:            string | null  // present only after migration 00005
  total_points:            number
  trading_points:          number
  bridge_points:           number
  daily_volume_usd:        number
  referral_trade_points:   number
  referral_bridge_points:  number
}

interface ReferrerRecord {
  referral_trade_points:   number
  referral_bridge_points:  number
  total_points:            number
}

interface AttributionResult {
  campaignId:    string
  campaignName:  string
  tradingPoints: number
  bridgePoints:  number
  referralBonus: number  // points credited to this wallet's referrer (info only)
  volumeUsd:     number
}

// ─── Supabase service-role client ─────────────────────────────────────────────

function makeServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } },
  )
}

type ServiceClient = ReturnType<typeof makeServiceClient>

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  // Allow localhost without auth (testing)
  const forwarded = req.headers.get('x-forwarded-for')
  const realIp    = req.headers.get('x-real-ip') ?? ''
  const ip        = forwarded?.split(',')[0].trim() ?? realIp
  if (ip === '127.0.0.1' || ip === '::1') return true

  const secret = process.env.WEBHOOK_SECRET
  if (!secret) return true   // no secret set — dev permissive mode

  return req.headers.get('x-webhook-secret') === secret
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validatePayload(body: unknown): { ok: true; payload: SwapPayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object' }
  const b = body as Record<string, unknown>

  const required: (keyof SwapPayload)[] = ['wallet', 'tx_hash', 'chain', 'token_in', 'token_out', 'amount_usd', 'timestamp']
  for (const field of required) {
    if (b[field] === undefined || b[field] === null || b[field] === '') {
      return { ok: false, error: `Missing required field: ${field}` }
    }
  }

  if (typeof b.amount_usd !== 'number' || b.amount_usd <= 0) {
    return { ok: false, error: 'amount_usd must be a positive number' }
  }
  if (typeof b.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(b.wallet)) {
    return { ok: false, error: 'wallet must be a valid EVM address (0x...)' }
  }
  if (typeof b.tx_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(b.tx_hash)) {
    return { ok: false, error: 'tx_hash must be a valid 32-byte hex hash (0x...)' }
  }

  return {
    ok: true,
    payload: {
      wallet:      (b.wallet      as string).toLowerCase(),
      tx_hash:     (b.tx_hash     as string).toLowerCase(),
      chain:       b.chain        as string,
      token_in:    b.token_in     as string,
      token_out:   b.token_out    as string,
      amount_usd:  b.amount_usd   as number,
      timestamp:   b.timestamp    as string,
      campaign_id: b.campaign_id  as string | undefined,
      is_bridge:   b.is_bridge    as boolean | undefined,
    },
  }
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse + validate ───────────────────────────────────────────────────────
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validatePayload(body)
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }

  const { wallet, tx_hash, chain, token_in, token_out, amount_usd, timestamp, campaign_id, is_bridge } = validation.payload
  const isBridge = is_bridge ?? false
  const supabase  = makeServiceClient()

  // ── Deduplicate: bail early if tx_hash already processed ──────────────────
  const { data: existing } = await supabase
    .from('swap_events')
    .select('id')
    .eq('tx_hash', tx_hash)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ success: true, credited: 0, skipped: true })
  }

  // ── Resolve participant rows for this wallet ───────────────────────────────
  let partQuery = supabase
    .from('participants')
    .select([
      'campaign_id',
      'observer',
      'total_points',
      'trading_points',
      'bridge_points',
      'daily_volume_usd',
      'referral_trade_points',
      'referral_bridge_points',
    ].join(','))
    .eq('wallet', wallet)

  if (campaign_id) partQuery = partQuery.eq('campaign_id', campaign_id)

  const { data: rawPartRows, error: partErr } = await partQuery

  if (partErr) {
    return NextResponse.json({ success: false, error: `DB error: ${partErr.message}` }, { status: 500 })
  }

  const participantRows = rawPartRows as unknown as ParticipantRecord[] | null

  // Record event even if wallet has no active campaigns (for audit trail)
  if (!participantRows || participantRows.length === 0) {
    await recordActivity(supabase, { tx_hash, wallet, chain, token_in, token_out, amount_usd, timestamp, isBridge })
    return NextResponse.json({ success: true, credited: 0, results: [], reason: 'no campaign participation found' })
  }

  // ── Load matching live campaigns ───────────────────────────────────────────
  const campaignIds = participantRows.map(p => p.campaign_id as string)

  const { data: campaigns, error: campErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'live')
    .in('id', campaignIds)

  if (campErr) {
    return NextResponse.json({ success: false, error: `DB error: ${campErr.message}` }, { status: 500 })
  }

  if (!campaigns || campaigns.length === 0) {
    await recordActivity(supabase, { tx_hash, wallet, chain, token_in, token_out, amount_usd, timestamp, isBridge })
    return NextResponse.json({ success: true, credited: 0, results: [], reason: 'no live campaigns matched' })
  }

  // ── Credit points for each matched campaign ────────────────────────────────
  const results: AttributionResult[] = []

  for (const campaign of campaigns as Campaign[]) {
    const participant = participantRows.find(p => p.campaign_id === campaign.id)
    if (!participant) continue

    const swapInput: SwapEventInput = {
      campaignId: campaign.id,
      wallet,
      volumeUsd:  amount_usd,
      isBridge,
    }

    const pts       = computeSwapPoints(swapInput, campaign)
    const increment = buildParticipantIncrement(pts)

    // Compute new participant totals
    const newTradingPts = (participant.trading_points   ?? 0) + (increment.trading_points ?? 0)
    const newBridgePts  = (participant.bridge_points    ?? 0) + (increment.bridge_points  ?? 0)
    const newDailyVol   = (participant.daily_volume_usd ?? 0) + increment.daily_volume_usd
    // total_points preserves any referral pts already accumulated
    const newTotalPts   = (participant.total_points     ?? 0) + pts.tradingPoints + pts.bridgePoints

    const { error: updateErr } = await supabase
      .from('participants')
      .update({
        trading_points:   newTradingPts,
        bridge_points:    newBridgePts,
        daily_volume_usd: newDailyVol,
        total_points:     newTotalPts,
      })
      .eq('campaign_id', campaign.id)
      .eq('wallet', wallet)

    if (updateErr) {
      // Log but don't abort — continue other campaigns
      console.error(`Failed to update participant ${wallet} for campaign ${campaign.id}:`, updateErr.message)
      continue
    }

    // ── Referral bonus ─────────────────────────────────────────────────────
    let referralBonus = 0

    // Fetch referred_by separately — column added by migration 00005.
    // If it errors (pre-migration), referrer stays null and bonus is skipped.
    let referrer: string | null = null
    if ((campaign.referral_share_pct ?? 0) > 0) {
      const { data: refRow } = await supabase
        .from('participants')
        .select('referred_by')
        .eq('campaign_id', campaign.id)
        .eq('wallet', wallet)
        .maybeSingle()
      referrer = (refRow as unknown as { referred_by: string | null } | null)?.referred_by ?? null
    }

    if (referrer && (campaign.referral_share_pct ?? 0) > 0) {
      const rawPts     = pts.tradingPoints + pts.bridgePoints
      referralBonus    = computeReferralPoints(rawPts, campaign.referral_share_pct!)

      if (referralBonus > 0) {
        const { data: referrerRow } = await supabase
          .from('participants')
          .select('referral_trade_points, referral_bridge_points, total_points')
          .eq('campaign_id', campaign.id)
          .eq('wallet', referrer)
          .maybeSingle()

        const typedReferrerRow = referrerRow as unknown as ReferrerRecord | null
        if (typedReferrerRow) {
          const newRefTradePts  = (typedReferrerRow.referral_trade_points  ?? 0) + (isBridge ? 0 : referralBonus)
          const newRefBridgePts = (typedReferrerRow.referral_bridge_points ?? 0) + (isBridge ? referralBonus : 0)
          const newRefTotalPts  = (typedReferrerRow.total_points           ?? 0) + referralBonus

          await supabase
            .from('participants')
            .update({
              referral_trade_points:  newRefTradePts,
              referral_bridge_points: newRefBridgePts,
              total_points:           newRefTotalPts,
            })
            .eq('campaign_id', campaign.id)
            .eq('wallet', referrer)
        }
      }
    }

    results.push({
      campaignId:    campaign.id,
      campaignName:  campaign.name,
      tradingPoints: pts.tradingPoints,
      bridgePoints:  pts.bridgePoints,
      referralBonus,
      volumeUsd:     pts.volumeUsdIncrement,
    })

    // ── Audit log — one activity row per campaign per event ────────────────
    const pointsEarned = pts.tradingPoints + pts.bridgePoints
    if (pointsEarned > 0) {
      await supabase.from('activity').insert({
        wallet,
        campaign_id:   campaign.id,
        action_type:   isBridge ? 'bridge' : 'trade',
        points_earned: pointsEarned,
        tx_hash,
        amount_usd,
        metadata: { chain, token_in, token_out },
      })
      // Non-fatal — don't abort if activity insert fails
    }
  }

  // ── Record in swap_events table ───────────────────────────────────────────
  await recordActivity(supabase, { tx_hash, wallet, chain, token_in, token_out, amount_usd, timestamp, isBridge })

  const credited = results.reduce((sum, r) => sum + r.tradingPoints + r.bridgePoints, 0)
  return NextResponse.json({ success: true, credited, results })
}

// ─── Record activity (dedup anchor) ───────────────────────────────────────────

async function recordActivity(
  supabase: ServiceClient,
  data: {
    tx_hash:    string
    wallet:     string
    chain:      string
    token_in:   string
    token_out:  string
    amount_usd: number
    timestamp:  string
    isBridge:   boolean
  },
) {
  // Non-fatal: if swap_events insert fails, log and continue
  const { error } = await supabase.from('swap_events').insert({
    tx_hash:     data.tx_hash,
    wallet:      data.wallet,
    chain:       data.chain,
    token_in:    data.token_in,
    token_out:   data.token_out,
    amount_usd:  data.amount_usd,
    occurred_at: data.timestamp,
    is_bridge:   data.isBridge,
  })
  if (error) {
    console.error('Failed to record activity (non-fatal):', error.message)
  }
}

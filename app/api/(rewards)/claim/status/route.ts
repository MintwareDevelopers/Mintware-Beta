// =============================================================================
// GET /api/claim/status?address=
//
// Returns all distributions a wallet is eligible to claim from, grouped by
// status: pending, claimable, claimed.
//
// Used by ClaimCard.tsx to populate the wallet's rewards UI.
//
// Response 200:
//   {
//     address: string
//     rewards: ClaimableReward[]
//     totals: { claimable_count: number, claimed_count: number, pending_count: number }
//   }
//
// ClaimableReward:
//   {
//     distribution_id: string | null
//     campaign_id: string
//     campaign_name: string
//     epoch_number: number
//     merkle_root: string | null
//     oracle_signature: string | null   // EIP-712 sig; null while status='pending'
//     amount_wei: string
//     payout_usd: number | null
//     token_symbol: string | null
//     token_address: string | null
//     contract_address: string | null
//     chain: string | null
//     status: 'claimable' | 'claimed' | 'pending'
//     claimed_at: string | null
//     published_at: string | null
//     created_at: string
//   }
//
// Status semantics:
//   claimable — distribution published, wallet in tree, not yet claimed
//   claimed   — wallet has already claimed (daily_payouts.claimed_at is set)
//   pending   — distribution not yet published on-chain (status: 'pending')
//
// Implementation note: daily_payouts has no direct FK to distributions.
// We do two queries (daily_payouts + campaigns, then distributions) and
// join them in JS via (campaign_id, epoch_number).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function GET(req: NextRequest) {
  const rawAddress = req.nextUrl.searchParams.get('address')

  if (!rawAddress) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 })
  }

  const address = rawAddress.toLowerCase()
  const supabase = createSupabaseServiceClient()

  // ---------------------------------------------------------------------------
  // Step 1: Get all daily_payouts for this wallet + campaign metadata.
  // tree_json is NOT selected here.
  // ---------------------------------------------------------------------------
  const { data: rows, error } = await supabase
    .from('daily_payouts')
    .select(`
      id,
      campaign_id,
      epoch_number,
      amount_wei,
      payout_usd,
      claimed_at,
      created_at,
      campaigns (
        id,
        name,
        token_symbol,
        token_contract,
        contract_address,
        chain
      )
    `)
    .eq('wallet', address)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[claim/status] daily_payouts query failed:', error.message)
    return NextResponse.json({ error: 'Failed to fetch rewards' }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({
      address,
      rewards: [],
      totals: { claimable_count: 0, claimed_count: 0, pending_count: 0 },
    })
  }

  // ---------------------------------------------------------------------------
  // Step 2: Fetch matching distributions.
  //
  // daily_payouts has no FK to distributions — join via (campaign_id, epoch_number).
  // Query distributions for all campaign_ids in this wallet's payouts, then
  // match by epoch_number in JS.
  // ---------------------------------------------------------------------------
  const campaignIds = [...new Set(rows.map((r) => r.campaign_id))]

  const { data: dists, error: distErr } = await supabase
    .from('distributions')
    .select('id, campaign_id, epoch_number, status, merkle_root, oracle_signature, published_at')
    .in('campaign_id', campaignIds)

  if (distErr) {
    console.error('[claim/status] distributions query failed:', distErr.message)
    // Non-fatal: return rewards with dist=null (all show as 'pending')
  }

  // Build a lookup map: `${campaign_id}:${epoch_number}` → distribution row
  const distMap = new Map<string, NonNullable<typeof dists>[number]>()
  for (const d of dists ?? []) {
    distMap.set(`${d.campaign_id}:${d.epoch_number}`, d)
  }

  // ---------------------------------------------------------------------------
  // Step 3: Shape each payout row into a ClaimableReward
  // ---------------------------------------------------------------------------
  const rewards = rows.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const campaign = Array.isArray(row.campaigns) ? row.campaigns[0] : (row.campaigns as any)
    const dist = distMap.get(`${row.campaign_id}:${row.epoch_number}`) ?? null

    let status: 'claimable' | 'claimed' | 'pending'
    if (row.claimed_at) {
      status = 'claimed'
    } else if (!dist || dist.status === 'pending') {
      status = 'pending'
    } else {
      // 'published' or 'finalized' + not yet claimed = claimable
      status = 'claimable'
    }

    return {
      distribution_id:  dist?.id ?? null,
      merkle_root:      dist?.merkle_root ?? null,
      oracle_signature: dist?.oracle_signature ?? null,
      campaign_id:      row.campaign_id,
      campaign_name:    campaign?.name ?? 'Unknown Campaign',
      epoch_number:     row.epoch_number,
      amount_wei:       row.amount_wei?.toString() ?? '0',
      payout_usd:       row.payout_usd,
      token_symbol:     campaign?.token_symbol ?? null,
      token_address:    campaign?.token_contract ?? null,
      contract_address: campaign?.contract_address ?? null,
      chain:            campaign?.chain ?? null,
      status,
      claimed_at:       row.claimed_at ?? null,
      published_at:     dist?.published_at ?? null,
      created_at:       row.created_at,
    }
  })

  const totals = {
    claimable_count: rewards.filter((r) => r.status === 'claimable').length,
    claimed_count:   rewards.filter((r) => r.status === 'claimed').length,
    pending_count:   rewards.filter((r) => r.status === 'pending').length,
  }

  return NextResponse.json({ address, rewards, totals })
}

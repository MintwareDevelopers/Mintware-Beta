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
//     distribution_id: string
//     campaign_id: string
//     campaign_name: string
//     epoch_number: number
//     amount_wei: string
//     token_symbol: string | null
//     token_address: string | null
//     contract_address: string | null
//     chain: string | null
//     status: 'claimable' | 'claimed' | 'pending'
//     claimed_at: string | null
//     created_at: string
//   }
//
// Status semantics:
//   claimable — distribution published, wallet in tree, not yet claimed
//   claimed   — wallet has already claimed (daily_payouts.claimed_at is set)
//   pending   — distribution not yet published on-chain (status: 'pending')
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const rawAddress = req.nextUrl.searchParams.get('address')

  if (!rawAddress) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 })
  }

  const address = rawAddress.toLowerCase()
  const supabase = createSupabaseServiceClient()

  // ---------------------------------------------------------------------------
  // Query all daily_payouts rows for this wallet.
  // Join distributions for status + tree metadata.
  // Join campaigns for routing + token metadata.
  //
  // We do NOT return tree_json from distributions — it's not selected here.
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
      distributions!inner (
        id,
        status,
        merkle_root,
        onchain_id,
        published_at
      ),
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
    console.error('[claim/status] Query failed:', error.message)
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
  // Shape each row into a ClaimableReward
  // ---------------------------------------------------------------------------
  const rewards = rows.map((row) => {
    // Supabase join returns arrays for 1:many, objects for 1:1 with !inner
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dist = Array.isArray(row.distributions) ? row.distributions[0] : (row.distributions as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const campaign = Array.isArray(row.campaigns) ? row.campaigns[0] : (row.campaigns as any)

    // Derive per-wallet status
    let status: 'claimable' | 'claimed' | 'pending'
    if (row.claimed_at) {
      status = 'claimed'
    } else if (dist?.status === 'pending') {
      status = 'pending'
    } else {
      // 'published' or 'finalized' distribution + not yet claimed = claimable
      status = 'claimable'
    }

    return {
      distribution_id: dist?.id ?? null,
      // String to avoid JS BigInt serialisation issues
      onchain_id: dist?.onchain_id !== null && dist?.onchain_id !== undefined
        ? String(dist.onchain_id)
        : null,
      campaign_id: row.campaign_id,
      campaign_name: campaign?.name ?? 'Unknown Campaign',
      epoch_number: row.epoch_number,
      amount_wei: row.amount_wei?.toString() ?? '0',
      payout_usd: row.payout_usd,
      token_symbol: campaign?.token_symbol ?? null,
      token_address: campaign?.token_contract ?? null,
      contract_address: campaign?.contract_address ?? null,
      chain: campaign?.chain ?? null,
      status,
      claimed_at: row.claimed_at ?? null,
      published_at: dist?.published_at ?? null,
      created_at: row.created_at,
    }
  })

  // ---------------------------------------------------------------------------
  // Summary totals
  // ---------------------------------------------------------------------------
  const totals = {
    claimable_count: rewards.filter((r) => r.status === 'claimable').length,
    claimed_count: rewards.filter((r) => r.status === 'claimed').length,
    pending_count: rewards.filter((r) => r.status === 'pending').length,
  }

  return NextResponse.json({ address, rewards, totals })
}

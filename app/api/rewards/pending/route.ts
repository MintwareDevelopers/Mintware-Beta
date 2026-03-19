// =============================================================================
// GET /api/rewards/pending?address=
//
// Returns all token reward pool earnings for a wallet, grouped by token.
// Covers all three reward types: buyer, referrer, platform_fee.
//
// Token amounts are price-locked at swap time (amount_wei set in swapHook).
// USD values reflect the price at the moment the referral was credited —
// not the current token price.
//
// Response 200:
//   {
//     address: string
//     by_token: TokenRewardGroup[]
//     totals: {
//       total_usd: number
//       locked_usd: number
//       claimable_usd: number
//       claimable_count: number
//       locked_count: number
//       claimed_count: number
//     }
//   }
//
// TokenRewardGroup:
//   {
//     token_symbol: string
//     token_contract: string
//     campaign_name: string
//     claimable_amount_wei: string   // sum of claimable rows, as string
//     locked_amount_wei: string      // sum of locked rows
//     total_amount_wei: string       // all rows (excl. claimed)
//     claimable_usd: number
//     locked_usd: number
//     total_usd: number
//     next_claimable_at: string | null  // earliest claimable_at still in 'locked'
//     rewards: PendingRewardRow[]
//   }
//
// PendingRewardRow:
//   {
//     id: string
//     campaign_id: string
//     campaign_name: string
//     reward_type: 'buyer' | 'referrer' | 'platform_fee'
//     amount_wei: string
//     reward_usd: number
//     purchase_amount_usd: number
//     tx_hash: string
//     status: 'locked' | 'claimable' | 'claimed' | 'expired'
//     claimable_at: string
//     created_at: string
//   }
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

  // Promote locked → claimable rows whose claimable_at has passed
  // Best-effort: don't fail the request if this errors
  await supabase
    .from('pending_rewards')
    .update({ status: 'claimable' })
    .eq('wallet', address)
    .eq('status', 'locked')
    .lte('claimable_at', new Date().toISOString())

  const { data: rows, error } = await supabase
    .from('pending_rewards')
    .select(`
      id,
      campaign_id,
      reward_type,
      token_contract,
      amount_wei,
      reward_usd,
      purchase_amount_usd,
      tx_hash,
      status,
      claimable_at,
      created_at,
      campaigns (
        id,
        name,
        token_symbol
      )
    `)
    .eq('wallet', address)
    .neq('status', 'expired')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[rewards/pending] query failed:', error.message)
    return NextResponse.json({ error: 'Failed to fetch rewards' }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({
      address,
      by_token: [],
      totals: {
        total_usd: 0,
        locked_usd: 0,
        claimable_usd: 0,
        claimable_count: 0,
        locked_count: 0,
        claimed_count: 0,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Group by token_contract
  // ---------------------------------------------------------------------------
  type GroupKey = string  // token_contract

  const groups = new Map<GroupKey, {
    token_symbol: string
    token_contract: string
    campaign_name: string
    rewards: object[]
    claimable_wei: bigint
    locked_wei: bigint
    claimed_wei: bigint
    claimable_usd: number
    locked_usd: number
    claimed_usd: number
    next_locked_claimable_at: string | null
  }>()

  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const campaign = Array.isArray(row.campaigns) ? row.campaigns[0] : (row.campaigns as any)
    const key = row.token_contract ?? ''

    if (!groups.has(key)) {
      groups.set(key, {
        token_symbol: campaign?.token_symbol ?? '',
        token_contract: key,
        campaign_name: campaign?.name ?? 'Unknown Campaign',
        rewards: [],
        claimable_wei: 0n,
        locked_wei: 0n,
        claimed_wei: 0n,
        claimable_usd: 0,
        locked_usd: 0,
        claimed_usd: 0,
        next_locked_claimable_at: null,
      })
    }

    const g = groups.get(key)!
    const amountWei = BigInt(row.amount_wei?.toString() ?? '0')
    const rewardUsd = row.reward_usd ?? 0

    if (row.status === 'claimable') {
      g.claimable_wei += amountWei
      g.claimable_usd += rewardUsd
    } else if (row.status === 'locked') {
      g.locked_wei += amountWei
      g.locked_usd += rewardUsd
      // Track the soonest claimable_at across locked rows
      if (
        row.claimable_at &&
        (!g.next_locked_claimable_at || row.claimable_at < g.next_locked_claimable_at)
      ) {
        g.next_locked_claimable_at = row.claimable_at
      }
    } else if (row.status === 'claimed') {
      g.claimed_wei += amountWei
      g.claimed_usd += rewardUsd
    }

    g.rewards.push({
      id: row.id,
      campaign_id: row.campaign_id,
      campaign_name: campaign?.name ?? 'Unknown Campaign',
      reward_type: row.reward_type,
      amount_wei: amountWei.toString(),
      reward_usd: rewardUsd,
      purchase_amount_usd: row.purchase_amount_usd ?? 0,
      tx_hash: row.tx_hash,
      status: row.status,
      claimable_at: row.claimable_at,
      created_at: row.created_at,
    })
  }

  // ---------------------------------------------------------------------------
  // Shape output
  // ---------------------------------------------------------------------------
  const by_token = Array.from(groups.values()).map((g) => ({
    token_symbol: g.token_symbol,
    token_contract: g.token_contract,
    campaign_name: g.campaign_name,
    claimable_amount_wei: g.claimable_wei.toString(),
    locked_amount_wei: g.locked_wei.toString(),
    total_amount_wei: (g.claimable_wei + g.locked_wei).toString(),
    claimable_usd: Math.round(g.claimable_usd * 100) / 100,
    locked_usd: Math.round(g.locked_usd * 100) / 100,
    total_usd: Math.round((g.claimable_usd + g.locked_usd) * 100) / 100,
    next_claimable_at: g.next_locked_claimable_at,
    rewards: g.rewards,
  }))

  // Sort: tokens with claimable balance first
  by_token.sort((a, b) => b.claimable_usd - a.claimable_usd)

  const totals = {
    total_usd: Math.round(by_token.reduce((s, t) => s + t.total_usd, 0) * 100) / 100,
    locked_usd: Math.round(by_token.reduce((s, t) => s + t.locked_usd, 0) * 100) / 100,
    claimable_usd: Math.round(by_token.reduce((s, t) => s + t.claimable_usd, 0) * 100) / 100,
    claimable_count: rows.filter((r) => r.status === 'claimable').length,
    locked_count: rows.filter((r) => r.status === 'locked').length,
    claimed_count: rows.filter((r) => r.status === 'claimed').length,
  }

  return NextResponse.json({ address, by_token, totals })
}

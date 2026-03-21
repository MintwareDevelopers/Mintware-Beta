// =============================================================================
// POST /api/campaigns/create
//
// Creates a campaign row in Supabase and returns the campaign ID.
// Called by Step5Review before the on-chain depositCampaign() call.
// The campaignId is then passed as the first arg to depositCampaign(id, token, amount).
//
// Body: { form: CreatorFormState, wallet: string }
// Response: { campaignId: string }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'
import type { CreatorFormState } from '@/lib/campaigns/creator'

const CHAIN_LABELS: Record<number, string> = {
  8453:  'Base',
  1:     'Ethereum',
  42161: 'Arbitrum',
}

export async function POST(req: NextRequest) {
  let body: { form: CreatorFormState; wallet: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { form, wallet } = body

  if (!form || !wallet) {
    return NextResponse.json({ error: 'Missing form or wallet' }, { status: 400 })
  }
  if (!form.token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 })
  }
  if (!form.type) {
    return NextResponse.json({ error: 'Campaign type required' }, { status: 400 })
  }

  const supabase      = createSupabaseServiceClient()
  const campaignType  = form.type === 'token_reward' ? 'token_pool' : 'points'
  const chain         = CHAIN_LABELS[form.chainId] ?? 'Base'
  const now           = new Date()

  const startAt = (form.schedule === 'scheduled' && form.startAt)
    ? new Date(form.startAt)
    : now

  const endDate = new Date(startAt.getTime() + form.durationDays * 24 * 60 * 60 * 1000)

  // Auto-generate name from token symbol and type
  const typeSuffix = campaignType === 'token_pool' ? 'Token Reward' : 'Points'
  const name = `${form.token.symbol} ${typeSuffix} Campaign`

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      name,
      status:               'upcoming',
      campaign_type:        campaignType,
      token_contract:       form.token.address.toLowerCase(),
      token_decimals:       form.token.decimals,
      chain,
      token_allocation_usd: form.poolUsd,
      pool_remaining_usd:   form.poolUsd,
      pool_usd:             form.poolUsd,
      buyer_reward_pct:     campaignType === 'token_pool' ? form.buyerRewardPct     : 0,
      referral_reward_pct:  campaignType === 'token_pool' ? form.referralRewardPct  : 0,
      platform_fee_pct:     2,
      use_score_multiplier: form.useScoreMultiplier,
      daily_wallet_cap_usd: form.dailyWalletCapUsd ?? 0,
      daily_pool_cap_usd:   form.dailyPoolCapUsd   ?? 0,
      contract_address:     process.env.NEXT_PUBLIC_DISTRIBUTOR_ADDRESS ?? null,
      creator:              wallet.toLowerCase(),
      end_date:             endDate.toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[campaigns/create] Supabase error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ campaignId: data.id })
}

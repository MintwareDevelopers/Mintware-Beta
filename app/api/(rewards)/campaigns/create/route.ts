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
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import type { CreatorFormState } from '@/lib/rewards/creator'
import { recoverMessageAddress } from 'viem'
import { buildCampaignCreateMessage } from '@/lib/web3/signedActionMessages'

const CHAIN_LABELS: Record<number, string> = {
  8453:  'Base',
  1:     'Ethereum',
  42161: 'Arbitrum',
}

const DISTRIBUTOR_ADDRESS: Record<number, string> = {
  8453:  process.env.DISTRIBUTOR_ADDRESS_BASE      ?? process.env.NEXT_PUBLIC_DISTRIBUTOR_ADDRESS ?? '',
  1:     process.env.DISTRIBUTOR_ADDRESS_ETHEREUM  ?? process.env.DISTRIBUTOR_ADDRESS_MAINNET ?? '',
  42161: process.env.DISTRIBUTOR_ADDRESS_ARBITRUM  ?? '',
}

export async function POST(req: NextRequest) {
  let body: {
    form: CreatorFormState
    wallet: string
    issuedAt?: number
    authMessage?: string
    authSignature?: `0x${string}`
  }
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
  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number') {
    return NextResponse.json({ error: 'Signed authorization required' }, { status: 401 })
  }
  if (Math.abs(Date.now() - body.issuedAt) > 15 * 60 * 1000) {
    return NextResponse.json({ error: 'Authorization expired' }, { status: 401 })
  }

  const expectedMessage = buildCampaignCreateMessage({
    wallet,
    issuedAt: body.issuedAt,
    form: {
      type: form.type,
      chainId: form.chainId,
      durationDays: form.durationDays,
      schedule: form.schedule,
      startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
      poolUsd: form.poolUsd,
      buyerRewardPct: form.buyerRewardPct,
      referralRewardPct: form.referralRewardPct,
      useScoreMultiplier: form.useScoreMultiplier,
      dailyWalletCapUsd: form.dailyWalletCapUsd,
      dailyPoolCapUsd: form.dailyPoolCapUsd,
      token: {
        address: form.token.address,
        symbol: form.token.symbol,
        name: form.token.name,
        decimals: form.token.decimals,
      },
    },
  })

  if (body.authMessage !== expectedMessage) {
    return NextResponse.json({ error: 'Authorization payload mismatch' }, { status: 401 })
  }

  const signer = await recoverMessageAddress({
    message: body.authMessage,
    signature: body.authSignature,
  }).catch(() => null)

  if (!signer || signer.toLowerCase() !== wallet.toLowerCase()) {
    return NextResponse.json({ error: 'Invalid authorization signature' }, { status: 401 })
  }

  const supabase      = createSupabaseServiceClient()
  const campaignType  = form.type === 'token_reward' ? 'token_pool' : 'points'
  const chain         = CHAIN_LABELS[form.chainId] ?? 'Base'
  const distributorAddress = DISTRIBUTOR_ADDRESS[form.chainId] ?? ''
  const now           = new Date()

  if (!CHAIN_LABELS[form.chainId]) {
    return NextResponse.json({ error: 'Unsupported campaign chain' }, { status: 400 })
  }
  if (!distributorAddress) {
    return NextResponse.json({ error: 'Campaign funding is not configured for this chain' }, { status: 400 })
  }

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
      contract_address:     distributorAddress,
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

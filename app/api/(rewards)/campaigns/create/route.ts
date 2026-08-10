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

import type { CreatorFormState } from '@/lib/rewards/creator'
import { createPublicClient, createWalletClient, http, recoverMessageAddress } from 'viem'
import { baseSepolia } from 'viem/chains'
import { buildCampaignCreateMessage } from '@/lib/web3/signedActionMessages'
import { randomUUID } from 'node:crypto'
import { createHandler } from '@/lib/web2/routeHandler'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { CAMPAIGN_DISTRIBUTOR_ABI } from '@/lib/web3/artifacts/campaignDistributor'

const CHAIN_LABELS: Record<number, string> = {
  8453:  'Base',
  84532: 'Base Sepolia',
  1:     'Ethereum',
  42161: 'Arbitrum',
}

const DISTRIBUTOR_ADDRESS: Record<number, string> = {
  8453:  process.env.DISTRIBUTOR_ADDRESS_BASE      ?? process.env.NEXT_PUBLIC_DISTRIBUTOR_ADDRESS ?? '',
  84532: process.env.DISTRIBUTOR_ADDRESS_BASE_SEPOLIA ?? process.env.NEXT_PUBLIC_DISTRIBUTOR_ADDRESS ?? '',
  1:     process.env.DISTRIBUTOR_ADDRESS_ETHEREUM  ?? process.env.DISTRIBUTOR_ADDRESS_MAINNET ?? '',
  42161: process.env.DISTRIBUTOR_ADDRESS_ARBITRUM  ?? '',
}

export const POST = createHandler(async (req, ctx) => {
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
    return ctx.json({ error: 'Invalid JSON' }, 400)
  }

  const { form, wallet } = body

  if (!form || !wallet) {
    return ctx.json({ error: 'Missing form or wallet' }, 400)
  }
  if (!form.token) {
    return ctx.json({ error: 'Token required' }, 400)
  }
  if (!form.type) {
    return ctx.json({ error: 'Campaign type required' }, 400)
  }
  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number') {
    return ctx.json({ error: 'Signed authorization required' }, 401)
  }
  if (Math.abs(Date.now() - body.issuedAt) > 15 * 60 * 1000) {
    return ctx.json({ error: 'Authorization expired' }, 401)
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
      surface: form.surface,
      linkedDealId: form.linkedDealId,
      durationMatchDays: form.durationMatchDays,
      token: {
        address: form.token.address,
        symbol: form.token.symbol,
        name: form.token.name,
        decimals: form.token.decimals,
      },
    },
  })

  if (body.authMessage !== expectedMessage) {
    return ctx.json({ error: 'Authorization payload mismatch' }, 401)
  }

  const signer = await recoverMessageAddress({
    message: body.authMessage,
    signature: body.authSignature,
  }).catch(() => null)

  if (!signer || signer.toLowerCase() !== wallet.toLowerCase()) {
    return ctx.json({ error: 'Invalid authorization signature' }, 401)
  }

  const campaignType  = form.type === 'token_reward' ? 'token_pool' : 'points'
  const distributorAddress = DISTRIBUTOR_ADDRESS[form.chainId] ?? ''
  const now           = new Date()

  // RWA surface shelved — every campaign is DeFi. surface/linked_deal_id/
  // duration_match_days remain in the signed payload + insert as inert 'defi'/null
  // (removing them from the signature is a deferred lockstep change).
  const surface = 'defi'
  const linkedDealId: string | null = null
  const durationMatchDays: number | null = null

  if (!CHAIN_LABELS[form.chainId]) {
    return ctx.json({ error: 'Unsupported campaign chain' }, 400)
  }
  if (!distributorAddress) {
    return ctx.json({ error: 'Campaign funding is not configured for this chain' }, 400)
  }

  const chain = CHAIN_LABELS[form.chainId]

  const startAt = (form.schedule === 'scheduled' && form.startAt)
    ? new Date(form.startAt)
    : now

  const endDate = new Date(startAt.getTime() + form.durationDays * 24 * 60 * 60 * 1000)

  // Auto-generate name from token symbol and type
  const typeSuffix = campaignType === 'token_pool' ? 'Token Reward' : 'Points'
  const name = `${form.token.symbol} ${typeSuffix} Campaign`

  // campaigns.id is `text PRIMARY KEY` with NO DB default — the row must carry an id or the insert
  // fails the not-null constraint. Generate one here; it becomes the on-chain campaignId string.
  const campaignId = randomUUID()

  const { data, error } = await ctx.supabase
    .from('campaigns')
    .insert({
      id: campaignId,
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
      surface,
      linked_deal_id:       linkedDealId,
      duration_match_days:  durationMatchDays,
    })
    .select('id')
    .single()

  if (error) {
    ctx.log.error('campaigns/create', 'Supabase error', { error })
    return ctx.json({ error: error.message }, 500)
  }

  // ── On-chain campaign registration (audit HIGH, PR #107) ──────────────────
  // The redeployed Base Sepolia distributor requires a campaign to be REGISTERED (token + creator
  // bound by an authorized registrar) BEFORE it can be funded — this is what closes the
  // first-depositor hijack. The campaign creator (the client) is not an authorized registrar, so the
  // backend must register on their behalf: the Privy oracle wallet is the contract owner ⇒ an
  // implicit registrar. Only Base Sepolia runs the fixed contract; legacy chains keep the old
  // first-depositor deposit flow untouched. If registration fails we roll back the just-inserted row
  // so the client never tries to fund an unregistered campaign (which would revert).
  let registration: { ok: true; tx: string } | undefined
  if (form.chainId === 84532) {
    try {
      const account = await getOracleSigner('root')
      const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
      const walletClient = createWalletClient({ account, chain: baseSepolia, transport })
      const publicClient = createPublicClient({ chain: baseSepolia, transport })
      const tx = await walletClient.writeContract({
        address: distributorAddress as `0x${string}`,
        abi: CAMPAIGN_DISTRIBUTOR_ABI,
        functionName: 'registerCampaign',
        args: [data.id as string, form.token.address as `0x${string}`, wallet as `0x${string}`],
        account,
        chain: baseSepolia,
      })
      const rcpt = await publicClient.waitForTransactionReceipt({ hash: tx })
      if (rcpt.status !== 'success') throw new Error('registerCampaign reverted')
      registration = { ok: true, tx }
    } catch (err) {
      await ctx.supabase.from('campaigns').delete().eq('id', data.id)
      ctx.log.error('campaigns/create', 'on-chain registerCampaign failed — rolled back row', {
        campaignId: data.id,
        error: err instanceof Error ? err.message : String(err),
      })
      return ctx.json(
        { error: 'On-chain campaign registration failed — please try again.' },
        502,
      )
    }
  }

  return ctx.json({ campaignId: data.id, registration })
}, { auth: 'none' })

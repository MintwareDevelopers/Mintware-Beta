import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { publishDistribution } from '@/lib/web3/onchainPublisher'

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

export interface UniversalDistributionBridgeResult {
  epoch_id: string
  distribution_id: string
  campaign_id: string
  published: boolean
}

export function universalCampaignId(chainId: number, poolId: string): string {
  return `universal:${chainId}:${poolId.toLowerCase()}`
}

function chainSlugFromChainId(chainId: number): string {
  switch (chainId) {
    case 8453:
      return 'base'
    case 84532:
      return 'base_sepolia'
    default:
      return `chain_${chainId}`
  }
}

function universalCampaignName(chainId: number, poolId: string): string {
  const shortPool = `${poolId.slice(0, 6)}...${poolId.slice(-4)}`
  return `Universal Pool ${chainId}:${shortPool}`
}

async function ensureUniversalCampaign(args: {
  campaignId: string
  chainId: number
  poolId: string
}) {
  const supabase = createSupabaseServiceClient()
  const chain = chainSlugFromChainId(args.chainId)
  const contractAddress = process.env.UNIVERSAL_DISTRIBUTOR_ADDRESS ?? null
  const tokenAddress = process.env.UNIVERSAL_SETTLEMENT_TOKEN_ADDRESS ?? null
  const tokenSymbol = process.env.UNIVERSAL_SETTLEMENT_TOKEN_SYMBOL ?? 'USDC'
  const rewardChain = (process.env.UNIVERSAL_SETTLEMENT_REWARD_CHAIN ?? 'evm') as 'evm' | 'solana'

  const upsertRow = {
    id: args.campaignId,
    campaign_type: 'points',
    name: universalCampaignName(args.chainId, args.poolId),
    status: 'live',
    closed: false,
    closed_at: null,
    start_date: null,
    end_date: null,
    token_contract: tokenAddress,
    token_decimals: Number(process.env.UNIVERSAL_SETTLEMENT_TOKEN_DECIMALS ?? 6),
    token_allocation_usd: null,
    buyer_reward_pct: null,
    referral_reward_pct: null,
    platform_fee_pct: 0,
    claim_duration_mins: null,
    pool_remaining_usd: null,
    pool_usd: null,
    token_symbol: tokenSymbol,
    epoch_duration_days: null,
    epoch_count: null,
    actions: null,
    min_score: 0,
    sponsorship_fee: null,
    contract_address: contractAddress,
    chain,
    reward_chain: rewardChain,
    reward_asset_type: 'erc20',
    reward_mint: tokenAddress,
    solana_program_id: null,
    solana_treasury_address: null,
    daily_wallet_cap_usd: null,
    daily_pool_cap_usd: null,
    use_score_multiplier: false,
    creator: null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('campaigns')
    .upsert(upsertRow, { onConflict: 'id' })

  if (error) {
    throw new Error(`[universalDistributionBridge] failed to upsert synthetic campaign ${args.campaignId}: ${error.message}`)
  }
}

async function nextEpochNumberForCampaign(campaignId: string): Promise<number> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('distributions')
    .select('epoch_number')
    .eq('campaign_id', campaignId)
    .order('epoch_number', { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(`[universalDistributionBridge] failed to determine next epoch number for ${campaignId}: ${error.message}`)
  }

  const lastEpoch = data?.[0]?.epoch_number ?? 0
  return lastEpoch + 1
}

export async function publishUniversalEpochToDistributor(epochId: string): Promise<UniversalDistributionBridgeResult> {
  const supabase = createSupabaseServiceClient()

  const { data: epoch, error: epochErr } = await supabase
    .from('universal_reward_epochs')
    .select(`
      id,
      chain_id,
      pool_id,
      trade_count,
      epoch_start,
      epoch_end,
      total_allocated_usd,
      merkle_root,
      total_usdc_wei,
      tree_json,
      distribution_id,
      status
    `)
    .eq('id', epochId)
    .single()

  if (epochErr || !epoch) {
    throw new Error(`[universalDistributionBridge] epoch not found: ${epochErr?.message ?? epochId}`)
  }

  if (epoch.distribution_id) {
    return {
      epoch_id: epoch.id,
      distribution_id: epoch.distribution_id,
      campaign_id: universalCampaignId(epoch.chain_id, epoch.pool_id),
      published: Boolean(epoch.merkle_root),
    }
  }

  if (!epoch.merkle_root || !epoch.tree_json || !epoch.total_usdc_wei) {
    throw new Error('[universalDistributionBridge] epoch does not have a claimable Merkle tree yet')
  }

  const campaignId = universalCampaignId(epoch.chain_id, epoch.pool_id)
  await ensureUniversalCampaign({
    campaignId,
    chainId: epoch.chain_id,
    poolId: epoch.pool_id,
  })
  const epochNumber = await nextEpochNumberForCampaign(campaignId)

  const { data: allocations, error: allocErr } = await supabase
    .from('universal_reward_allocations')
    .select('recipient, recipient_type, amount_usd, amount_usdc_wei, merkle_proof, included_in_merkle')
    .eq('epoch_id', epoch.id)
    .eq('included_in_merkle', true)

  if (allocErr) {
    throw new Error(`[universalDistributionBridge] failed to load allocations for epoch ${epoch.id}: ${allocErr.message}`)
  }

  const walletRows = (allocations ?? []).filter((row: { recipient: string; recipient_type: string; amount_usd: number | null; amount_usdc_wei: string | null; merkle_proof: string[] | null; included_in_merkle: boolean }) => ADDRESS_RE.test(row.recipient))
  const now = new Date().toISOString()

  const { data: dist, error: distErr } = await supabase
    .from('distributions')
    .insert({
      campaign_id: campaignId,
      epoch_number: epochNumber,
      merkle_root: epoch.merkle_root,
      total_amount_usd: epoch.total_allocated_usd,
      total_amount_wei: epoch.total_usdc_wei,
      participant_count: walletRows.length,
      tree_json: epoch.tree_json,
      status: 'pending',
      settlement_chain: process.env.UNIVERSAL_SETTLEMENT_REWARD_CHAIN ?? 'evm',
      created_at: now,
    })
    .select('id')
    .single()

  if (distErr || !dist) {
    throw new Error(`[universalDistributionBridge] failed to insert distribution for epoch ${epoch.id}: ${distErr?.message}`)
  }

  if (walletRows.length > 0) {
    const tokenPriceUsd = Number(process.env.UNIVERSAL_SETTLEMENT_TOKEN_PRICE_USD ?? 1)
    const payoutRows = walletRows.map((row: { recipient: string; amount_usd: number | null; amount_usdc_wei: string | null; merkle_proof: string[] | null }) => ({
      campaign_id: campaignId,
      wallet: row.recipient.toLowerCase(),
      epoch_number: epochNumber,
      points: 0,
      multiplier: 1,
      payout_usd: row.amount_usd,
      amount_wei: row.amount_usdc_wei ?? '0',
      token_price_usd: tokenPriceUsd,
      merkle_proof: row.merkle_proof ?? [],
      distribution_id: dist.id,
      created_at: now,
    }))

    const { error: payoutErr } = await supabase
      .from('daily_payouts')
      .upsert(payoutRows, { onConflict: 'campaign_id,wallet,epoch_number' })

    if (payoutErr) {
      throw new Error(`[universalDistributionBridge] failed to insert payout rows for epoch ${epoch.id}: ${payoutErr.message}`)
    }
  }

  const shouldPublish =
    process.env.UNIVERSAL_DISTRIBUTOR_ADDRESS &&
    process.env.UNIVERSAL_SETTLEMENT_REWARD_CHAIN !== 'solana'

  let published = false
  if (shouldPublish) {
    const contractAddress = process.env.UNIVERSAL_DISTRIBUTOR_ADDRESS as `0x${string}`
    if (!ADDRESS_RE.test(contractAddress)) {
      throw new Error('[universalDistributionBridge] UNIVERSAL_DISTRIBUTOR_ADDRESS must be a valid address when set')
    }

    await publishDistribution({
      distribution_db_id: dist.id,
      campaign_id_str: campaignId,
      epoch_number: epochNumber,
      merkle_root: epoch.merkle_root,
      contract_address: contractAddress,
      chain: chainSlugFromChainId(epoch.chain_id),
    })
    published = true
  }

  const { error: epochUpdateErr } = await supabase
    .from('universal_reward_epochs')
    .update({
      distribution_id: dist.id,
      status: published ? 'published' : epoch.status,
      published_at: published ? now : null,
    })
    .eq('id', epoch.id)

  if (epochUpdateErr) {
    throw new Error(`[universalDistributionBridge] failed to update epoch bridge state for ${epoch.id}: ${epochUpdateErr.message}`)
  }

  return {
    epoch_id: epoch.id,
    distribution_id: dist.id,
    campaign_id: campaignId,
    published,
  }
}

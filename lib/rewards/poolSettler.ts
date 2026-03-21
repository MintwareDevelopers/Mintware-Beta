// =============================================================================
// poolSettler.ts — Token Pool batch settlement
// Ticket 2 follow-up: settle claimable pending_rewards into Merkle distributions
//
// Called by POST /api/cron/pool-settle on a recurring schedule.
// Handles the token_pool claim flow end-to-end:
//   1. Auto-promote locked → claimable where claimable_at has passed
//   2. Load all claimable pending_rewards rows
//   3. Group by campaign_id
//   4. Per campaign: sum amount_wei per wallet, build StandardMerkleTree
//   5. Write distributions + daily_payouts rows to DB
//   6. Sign oracle signature via publishDistribution() (zero gas)
//   7. Auto-claim treasury fee leaf (platform_fee rows) if applicable
//   8. Mark settled pending_rewards as 'claimed'
//
// Rows with amount_wei = '0' (price fetch failed at swap time) are retried:
// this module re-resolves the price. Rows where price is still unavailable
// are left claimable for the next cron run.
// =============================================================================

import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { getTokenPrice, usdToWei } from '@/lib/rewards/priceFeed'
import { publishDistribution } from '@/lib/web3/onchainPublisher'
import type { Campaign } from '@/lib/rewards/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoolBatchResult {
  campaign_id: string
  batch_epoch: number
  wallets: number
  total_amount_wei: string
  total_usd: number
  distribution_id: string
  signed: boolean
  treasury_claim_tx?: string
  error?: string
}

export interface PoolSettleReport {
  campaigns_settled: number
  campaigns_skipped: number
  rewards_settled: number
  results: PoolBatchResult[]
}

// Shape of a pending_rewards row from Supabase
interface PendingRewardRow {
  id: string
  campaign_id: string
  wallet: string
  referrer: string | null
  reward_type: 'buyer' | 'referrer' | 'platform_fee'
  token_contract: string
  amount_wei: string
  reward_usd: number
  tx_hash: string
  claimable_at: string
  status: string
}

// ---------------------------------------------------------------------------
// settleTokenPoolBatch — main export
// ---------------------------------------------------------------------------

export async function settleTokenPoolBatch(): Promise<PoolSettleReport> {
  const supabase = createSupabaseServiceClient()
  const now = new Date().toISOString()

  // Step 1: Auto-promote locked → claimable where claimable_at has passed
  await supabase
    .from('pending_rewards')
    .update({ status: 'claimable' })
    .eq('status', 'locked')
    .lte('claimable_at', now)

  // Step 2: Load all claimable rows
  const { data: claimableRows, error: fetchErr } = await supabase
    .from('pending_rewards')
    .select('id, campaign_id, wallet, referrer, reward_type, token_contract, amount_wei, reward_usd, tx_hash, claimable_at, status')
    .eq('status', 'claimable')

  if (fetchErr) {
    throw new Error(`[poolSettler] Failed to fetch claimable rewards: ${fetchErr.message}`)
  }

  const rows = (claimableRows ?? []) as PendingRewardRow[]

  if (rows.length === 0) {
    return { campaigns_settled: 0, campaigns_skipped: 0, rewards_settled: 0, results: [] }
  }

  // Step 3: Group by campaign_id
  const byCampaign = new Map<string, PendingRewardRow[]>()
  for (const row of rows) {
    const arr = byCampaign.get(row.campaign_id) ?? []
    arr.push(row)
    byCampaign.set(row.campaign_id, arr)
  }

  const results: PoolBatchResult[] = []
  let campaigns_skipped = 0
  let rewards_settled = 0

  // Step 4+: Settle each campaign sequentially
  for (const [campaign_id, campaignRows] of byCampaign) {
    try {
      const result = await settleCampaignBatch(supabase, campaign_id, campaignRows, now)
      results.push(result)
      if (!result.error) {
        rewards_settled += campaignRows.length
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[poolSettler] campaign ${campaign_id} batch failed:`, msg)
      campaigns_skipped++
      results.push({
        campaign_id,
        batch_epoch: 0,
        wallets: 0,
        total_amount_wei: '0',
        total_usd: 0,
        distribution_id: '',
        signed: false,
        error: msg,
      })
    }
  }

  return {
    campaigns_settled: results.filter(r => !r.error).length,
    campaigns_skipped,
    rewards_settled,
    results,
  }
}

// ---------------------------------------------------------------------------
// settleCampaignBatch — settle one campaign's claimable rewards into a batch
// ---------------------------------------------------------------------------

async function settleCampaignBatch(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  campaign_id: string,
  rows: PendingRewardRow[],
  now: string
): Promise<PoolBatchResult> {
  // Load campaign config
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaign_id)
    .single()

  if (cErr || !campaign) {
    throw new Error(`campaign not found: ${cErr?.message}`)
  }

  const typedCampaign = campaign as Campaign
  const decimals = typedCampaign.token_decimals ?? 18
  const symbol = typedCampaign.token_symbol ?? ''
  const treasuryWallet = (process.env.MINTWARE_TREASURY_ADDRESS ?? '').toLowerCase()

  // ---------------------------------------------------------------------------
  // Retry price resolution for rows where amount_wei = '0'
  // (price feed failed at swap time — try again now)
  // ---------------------------------------------------------------------------
  let retryTokenPrice: number | null = null
  const hasZeroWeiRows = rows.some(r => r.amount_wei === '0' && r.reward_usd > 0)

  if (hasZeroWeiRows && symbol) {
    try {
      retryTokenPrice = await getTokenPrice(symbol)
    } catch {
      console.warn(
        `[poolSettler] price retry failed for ${symbol} (campaign ${campaign_id}) ` +
        `— rows with amount_wei='0' will be deferred to next run`
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Sum amount_wei per wallet
  // Separate platform_fee rows — they go to the treasury wallet leaf.
  // Rows still at '0' wei after retry are excluded (deferred to next run).
  // ---------------------------------------------------------------------------
  type WalletEntry = { amount_wei: bigint; reward_usd: number; row_ids: string[] }
  const walletMap = new Map<string, WalletEntry>()
  const deferredIds: string[] = []   // rows with unresolvable price

  function addToWallet(walletKey: string, wei: bigint, usd: number, id: string) {
    const existing = walletMap.get(walletKey) ?? { amount_wei: 0n, reward_usd: 0, row_ids: [] }
    existing.amount_wei += wei
    existing.reward_usd += usd
    existing.row_ids.push(id)
    walletMap.set(walletKey, existing)
  }

  for (const row of rows) {
    let rowWei = BigInt(row.amount_wei || '0')

    // Retry price resolution if wei is 0 but we have a USD value and a fresh price
    if (rowWei === 0n && row.reward_usd > 0 && retryTokenPrice !== null && retryTokenPrice > 0) {
      rowWei = usdToWei(row.reward_usd, retryTokenPrice, decimals)
      // Update the DB row with the resolved amount_wei
      await supabase
        .from('pending_rewards')
        .update({ amount_wei: rowWei.toString() })
        .eq('id', row.id)
    }

    if (rowWei === 0n) {
      // Price still unresolvable — defer to next run
      deferredIds.push(row.id)
      continue
    }

    if (row.reward_type === 'platform_fee') {
      // Platform fee → treasury wallet leaf
      if (treasuryWallet) {
        addToWallet(treasuryWallet, rowWei, row.reward_usd, row.id)
      } else {
        // No treasury configured — defer rather than silently drop
        deferredIds.push(row.id)
      }
    } else {
      // buyer / referrer → the reward recipient's wallet
      addToWallet(row.wallet.toLowerCase(), rowWei, row.reward_usd, row.id)
    }
  }

  if (deferredIds.length > 0) {
    console.warn(
      `[poolSettler] campaign ${campaign_id}: ${deferredIds.length} rows deferred ` +
      `(unresolvable price or missing treasury address) — will retry next run`
    )
  }

  if (walletMap.size === 0) {
    throw new Error(
      `[poolSettler] campaign ${campaign_id}: no wallet entries after processing ` +
      `(${deferredIds.length} deferred)`
    )
  }

  // ---------------------------------------------------------------------------
  // Build StandardMerkleTree from [wallet, amount_wei] pairs
  // ---------------------------------------------------------------------------
  const leaves = Array.from(walletMap.entries()).map(([wallet, entry]) => ({
    wallet,
    amount_wei: entry.amount_wei.toString(),
    reward_usd: entry.reward_usd,
    row_ids: entry.row_ids,
  }))

  const tree = StandardMerkleTree.of(
    leaves.map(l => [l.wallet, l.amount_wei]),
    ['address', 'uint256']
  )

  // Extract per-wallet proofs
  const proofMap = new Map<string, string[]>()
  for (const [i, [wallet]] of tree.entries()) {
    proofMap.set((wallet as string).toLowerCase(), tree.getProof(i))
  }

  const total_amount_wei = leaves.reduce((sum, l) => sum + BigInt(l.amount_wei), 0n).toString()
  const total_usd = leaves.reduce((sum, l) => sum + l.reward_usd, 0)

  // ---------------------------------------------------------------------------
  // Determine batch epoch number (sequential per campaign)
  // ---------------------------------------------------------------------------
  const { data: lastDist } = await supabase
    .from('distributions')
    .select('epoch_number')
    .eq('campaign_id', campaign_id)
    .order('epoch_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const batch_epoch = (lastDist?.epoch_number ?? 0) + 1

  // ---------------------------------------------------------------------------
  // Write distributions row
  // ---------------------------------------------------------------------------
  const { data: dist, error: distErr } = await supabase
    .from('distributions')
    .insert({
      campaign_id,
      epoch_number: batch_epoch,
      merkle_root: tree.root,
      total_amount_usd: total_usd,
      total_amount_wei,
      participant_count: walletMap.size,
      tree_json: tree.dump(),
      status: 'pending',
      created_at: now,
    })
    .select('id')
    .single()

  if (distErr || !dist) {
    throw new Error(`distributions insert failed: ${distErr?.message}`)
  }

  // ---------------------------------------------------------------------------
  // Write daily_payouts rows (one per wallet in this batch)
  // For token_pool campaigns: points=0, multiplier=1.0, token_price_usd=0
  // (amount_wei was price-locked at swap time, no recalculation needed)
  // ---------------------------------------------------------------------------
  const payoutRows = leaves.map(leaf => ({
    campaign_id,
    epoch_number: batch_epoch,
    wallet: leaf.wallet,
    points: 0,
    multiplier: 1.0,
    payout_usd: leaf.reward_usd,
    amount_wei: leaf.amount_wei,
    token_price_usd: 0,
    merkle_proof: proofMap.get(leaf.wallet) ?? [],
    created_at: now,
  }))

  const { error: payoutErr } = await supabase
    .from('daily_payouts')
    .upsert(payoutRows, { onConflict: 'campaign_id,epoch_number,wallet', ignoreDuplicates: true })

  if (payoutErr) {
    console.error(`[poolSettler] daily_payouts upsert error for campaign ${campaign_id}:`, payoutErr.message)
    // Non-fatal — distribution row is committed; operator can backfill
  }

  // ---------------------------------------------------------------------------
  // Mark all settled pending_rewards as 'claimed'
  // Deferred rows are NOT touched — they stay 'claimable' for the next run.
  // ---------------------------------------------------------------------------
  const settledIds = leaves.flatMap(l => l.row_ids)

  if (settledIds.length > 0) {
    const { error: markErr } = await supabase
      .from('pending_rewards')
      .update({ status: 'claimed' })
      .in('id', settledIds)

    if (markErr) {
      // Non-fatal — worst case the rows are re-processed next run and hit the
      // upsert's ignoreDuplicates on daily_payouts. The distribution is valid.
      console.error(
        `[poolSettler] pending_rewards mark-claimed error for campaign ${campaign_id}: ` +
        markErr.message
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Sign oracle signature via publishDistribution() (zero gas)
  // Optionally auto-claim treasury fee immediately after signing.
  // ---------------------------------------------------------------------------
  let signed = false
  let treasury_claim_tx: string | undefined

  if (typedCampaign.contract_address && typedCampaign.chain) {
    try {
      const treasuryLeaf = treasuryWallet
        ? leaves.find(l => l.wallet === treasuryWallet)
        : undefined

      const publishResult = await publishDistribution({
        distribution_db_id: dist.id,
        campaign_id_str:    campaign_id,
        epoch_number:       batch_epoch,
        merkle_root:        tree.root,
        contract_address:   typedCampaign.contract_address,
        chain:              typedCampaign.chain,
        treasury_claim: treasuryLeaf
          ? {
              amount_wei: treasuryLeaf.amount_wei,
              proof: proofMap.get(treasuryWallet) ?? [],
            }
          : undefined,
      })

      signed = true
      treasury_claim_tx = publishResult.treasury_claim_tx

      console.log(
        `[poolSettler] ✓ campaign ${campaign_id} batch ${batch_epoch} signed: ` +
        `${walletMap.size} wallets, ${total_usd.toFixed(2)} USD total` +
        (treasury_claim_tx ? ` treasury_tx=${treasury_claim_tx}` : '')
      )
    } catch (publishErr) {
      const msg = publishErr instanceof Error ? publishErr.message : String(publishErr)
      console.error(
        `[poolSettler] ⚠ oracle signing failed for campaign ${campaign_id} ` +
        `distribution ${dist.id}: ${msg}. ` +
        `Distribution written as 'pending' — will auto-sign on next run.`
      )
      // Non-fatal — distribution is in DB, pending_rewards are marked claimed.
      // Oracle will sign on the next cron run when it finds 'pending' distributions.
    }
  } else {
    console.warn(
      `[poolSettler] campaign ${campaign_id} has no contract_address/chain — ` +
      `distribution ${dist.id} written as 'pending'. ` +
      `Set contract_address and chain in Supabase after deploying to enable claiming.`
    )
  }

  return {
    campaign_id,
    batch_epoch,
    wallets: walletMap.size,
    total_amount_wei,
    total_usd,
    distribution_id: dist.id,
    signed,
    treasury_claim_tx,
  }
}

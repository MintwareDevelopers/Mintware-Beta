// =============================================================================
// merkleBuilder.ts — Merkle tree construction and distribution writing
// Ticket 4: Epoch distribution
//
// Uses @openzeppelin/merkle-tree (StandardMerkleTree).
// Leaf encoding: keccak256(abi.encode(address wallet, uint256 amount))
// This matches the OpenZeppelin MerkleDistributor contract standard —
// the claim contract (Ticket 5) will verify proofs against the same encoding.
//
// Flow:
//   1. Convert payout_usd → amount_wei per wallet (via priceFeed)
//   2. Build StandardMerkleTree from [wallet, amount_wei] pairs
//   3. Extract root + per-wallet proofs
//   4. Write to distributions table (root, tree_json, total_amount_wei)
//   5. Write to daily_payouts table (one row per wallet with proof)
//   6. Reset participant.total_points for next epoch
//   7. Advance epoch_state to next epoch (or end campaign if final epoch)
// =============================================================================

import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { createSupabaseServiceClient } from '@/lib/supabase'
import { getTokenPrice, usdToWei } from '@/lib/campaigns/priceFeed'
import type { EpochProcessorResult, DistributionEntry } from '@/lib/campaigns/epochProcessor'
import type { Campaign } from '@/lib/campaigns/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MerkleLeaf {
  wallet: string
  amount_wei: string   // bigint as string — Merkle tree requires string
  proof: string[]
}

export interface MerkleResult {
  root: string
  leaves: MerkleLeaf[]
  total_amount_wei: string
  token_price_usd: number
  tree_dump: object   // StandardMerkleTree.dump() — serialisable for storage
}

export interface BuilderSummary {
  campaign_id: string
  epoch_number: number
  distribution_id: string
  merkle_root: string
  wallets_included: number
  total_payout_usd: number
  total_amount_wei: string
  token_price_usd: number
  next_epoch_created: boolean
  campaign_ended: boolean
}

// ---------------------------------------------------------------------------
// buildMerkleTree — constructs tree from distribution entries + token price
// ---------------------------------------------------------------------------

export function buildMerkleTree(
  entries: DistributionEntry[],
  token_price_usd: number,
  token_decimals: number
): MerkleResult {
  if (entries.length === 0) {
    throw new Error('[merkleBuilder] Cannot build Merkle tree with 0 entries')
  }

  // Convert USD payouts to wei amounts
  const weiAmounts = entries.map((e) => ({
    wallet: e.wallet,
    amount_wei: usdToWei(e.payout_usd, token_price_usd, token_decimals),
  }))

  // Build StandardMerkleTree — leaf: [address, uint256]
  // OpenZeppelin sorts and hashes leaves deterministically
  const tree = StandardMerkleTree.of(
    weiAmounts.map((w) => [w.wallet, w.amount_wei.toString()]),
    ['address', 'uint256']
  )

  // Extract proofs per wallet
  const proofMap = new Map<string, string[]>()
  for (const [i, [wallet]] of tree.entries()) {
    proofMap.set((wallet as string).toLowerCase(), tree.getProof(i))
  }

  const leaves: MerkleLeaf[] = weiAmounts.map((w) => ({
    wallet: w.wallet,
    amount_wei: w.amount_wei.toString(),
    proof: proofMap.get(w.wallet.toLowerCase()) ?? [],
  }))

  const total_amount_wei = weiAmounts
    .reduce((sum, w) => sum + w.amount_wei, 0n)
    .toString()

  return {
    root: tree.root,
    leaves,
    total_amount_wei,
    token_price_usd,
    tree_dump: tree.dump(),
  }
}

// ---------------------------------------------------------------------------
// commitDistribution — writes Merkle results to Supabase and resets epoch
//
// All DB writes are done sequentially (not in a transaction — Supabase REST
// doesn't support multi-table transactions). Order is:
//   1. Insert distributions row  ← if this fails, nothing else runs
//   2. Insert daily_payouts rows ← if this fails, distribution row exists but has no payouts
//   3. Reset participant points  ← if this fails, points not reset but data is correct
//   4. Advance epoch_state       ← idempotent (unique index prevents duplicates)
//
// The epoch-end cron marks the epoch as 'settling' before calling this, so
// if any step fails the cron can detect 'settling' epochs and retry.
// ---------------------------------------------------------------------------

export async function commitDistribution(
  campaign: Campaign,
  epochState: { id: string; campaign_id: string; epoch_number: number; epoch_pool_usd: number },
  processorResult: EpochProcessorResult,
  merkleResult: MerkleResult
): Promise<BuilderSummary> {
  const supabase = createSupabaseServiceClient()
  const now = new Date().toISOString()

  // 1. Insert distributions row
  const { data: dist, error: distErr } = await supabase
    .from('distributions')
    .insert({
      campaign_id: campaign.id,
      epoch_number: epochState.epoch_number,
      merkle_root: merkleResult.root,
      total_amount_usd: processorResult.total_payout_usd,
      total_amount_wei: merkleResult.total_amount_wei,
      participant_count: merkleResult.leaves.length,
      tree_json: merkleResult.tree_dump,
      status: 'pending',   // 'published' is set when merkle root goes on-chain (Ticket 5)
      created_at: now,
    })
    .select('id')
    .single()

  if (distErr || !dist) {
    throw new Error(`[merkleBuilder] distributions insert failed: ${distErr?.message}`)
  }

  // 2. Insert daily_payouts (one per wallet)
  // Build a map from wallet → DistributionEntry for fast lookup
  const entryMap = new Map<string, DistributionEntry>(
    processorResult.entries.map((e) => [e.wallet.toLowerCase(), e])
  )

  const payoutRows = merkleResult.leaves.map((leaf) => {
    const entry = entryMap.get(leaf.wallet.toLowerCase())!
    return {
      campaign_id: campaign.id,
      epoch_number: epochState.epoch_number,
      wallet: leaf.wallet,
      points: entry.points,
      multiplier: entry.multipliers.combined,
      payout_usd: entry.payout_usd,
      amount_wei: leaf.amount_wei,
      token_price_usd: merkleResult.token_price_usd,
      merkle_proof: leaf.proof,
      created_at: now,
    }
  })

  const { error: payoutErr } = await supabase
    .from('daily_payouts')
    .upsert(payoutRows, { onConflict: 'campaign_id,epoch_number,wallet', ignoreDuplicates: true })

  if (payoutErr) {
    // Non-fatal: distribution row is committed. Log and continue.
    console.error('[merkleBuilder] daily_payouts upsert error:', payoutErr.message)
  }

  // 3. Reset participant.total_points to 0 for next epoch
  // Update each participant individually — Supabase doesn't support bulk update
  // with per-row values, and we only want to reset the ones included in this epoch.
  const wallets = merkleResult.leaves.map((l) => l.wallet)
  if (wallets.length > 0) {
    const { error: resetErr } = await supabase
      .from('participants')
      .update({ total_points: 0, updated_at: now })
      .eq('campaign_id', campaign.id)
      .in('wallet', wallets)

    if (resetErr) {
      console.error('[merkleBuilder] participant points reset error:', resetErr.message)
    }
  }

  // 4. Mark current epoch complete
  await supabase
    .from('epoch_state')
    .update({ status: 'complete', updated_at: now })
    .eq('id', epochState.id)

  // 5. Advance to next epoch or end campaign
  const epoch_count = campaign.epoch_count ?? 1
  const isLastEpoch = epochState.epoch_number >= epoch_count

  let next_epoch_created = false
  let campaign_ended = false

  if (isLastEpoch) {
    // Final epoch — mark campaign ended
    await supabase
      .from('campaigns')
      .update({ status: 'ended', updated_at: now })
      .eq('id', campaign.id)
    campaign_ended = true
  } else {
    // Create next epoch_state row
    const epoch_duration_days = campaign.epoch_duration_days ?? 7
    const nextEpochStart = now
    const nextEpochEnd = new Date(
      Date.now() + epoch_duration_days * 86_400_000
    ).toISOString()

    const { error: nextEpochErr } = await supabase
      .from('epoch_state')
      .insert({
        campaign_id: campaign.id,
        epoch_number: epochState.epoch_number + 1,
        epoch_start: nextEpochStart,
        epoch_end: nextEpochEnd,
        epoch_pool_usd: epochState.epoch_pool_usd,   // same pool split per epoch
        total_points: 0,
        status: 'active',
        created_at: now,
        updated_at: now,
      })

    if (nextEpochErr) {
      console.error('[merkleBuilder] next epoch_state insert error:', nextEpochErr.message)
    } else {
      next_epoch_created = true
    }
  }

  return {
    campaign_id: campaign.id,
    epoch_number: epochState.epoch_number,
    distribution_id: dist.id,
    merkle_root: merkleResult.root,
    wallets_included: merkleResult.leaves.length,
    total_payout_usd: processorResult.total_payout_usd,
    total_amount_wei: merkleResult.total_amount_wei,
    token_price_usd: merkleResult.token_price_usd,
    next_epoch_created,
    campaign_ended,
  }
}

// ---------------------------------------------------------------------------
// runMerkleBuilder — orchestrates the full build + commit for one epoch
// Called by the epoch-end cron after processEpoch() returns.
// ---------------------------------------------------------------------------

export async function runMerkleBuilder(
  campaign: Campaign,
  epochState: { id: string; campaign_id: string; epoch_number: number; epoch_pool_usd: number },
  processorResult: EpochProcessorResult
): Promise<BuilderSummary> {
  if (processorResult.entries.length === 0) {
    throw new Error(
      `[merkleBuilder] No eligible entries for campaign ${campaign.id} epoch ${epochState.epoch_number}. ` +
      `Epoch had ${processorResult.wallets_excluded_zero_points} wallets with 0 points.`
    )
  }

  const token_symbol = campaign.token_symbol ?? 'USDC'
  const token_decimals = (campaign as Campaign & { token_decimals?: number }).token_decimals ?? 18

  // Resolve token price — throws if unavailable (epoch-end cron handles retry)
  const token_price_usd = await getTokenPrice(token_symbol)

  // Build Merkle tree
  const merkleResult = buildMerkleTree(
    processorResult.entries,
    token_price_usd,
    token_decimals
  )

  // Commit to DB
  return commitDistribution(campaign, epochState, processorResult, merkleResult)
}

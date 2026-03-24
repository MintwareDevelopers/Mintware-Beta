// =============================================================================
// vaultMerkleBuilder.ts — Merkle tree construction for vault LP distributions
// T2.4: Vault epoch close automation
//
// Builds a StandardMerkleTree of [wallet, usdc_amount_wei] pairs for an epoch.
// USDC has 6 decimals — amounts are scaled to uint256 as raw USDC units × 1e6.
//
// Leaf encoding: keccak256(abi.encode(address wallet, uint256 amount))
// Matches OpenZeppelin StandardMerkleTree / MintwareDistributor.sol claim logic.
//
// Flow:
//   1. Convert payout_usdc → usdc_amount_wei (multiply by 1e6, no price feed needed)
//   2. Build StandardMerkleTree from [wallet, amount_wei] pairs
//   3. Extract root + per-wallet proofs
//   4. Write merkle_root, tree_json, deadline, status='published' to vault_epochs
//   5. Open next epoch row (status='active')
// =============================================================================

import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import type { VaultEpochProcessorResult, VaultDistributionEntry } from './vaultEpochProcessor'

const USDC_DECIMALS = 6

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultMerkleLeaf {
  wallet: string
  usdc_amount_wei: string  // bigint as string (USDC × 1e6)
  proof: string[]
}

export interface VaultMerkleResult {
  root: string
  leaves: VaultMerkleLeaf[]
  total_usdc_wei: string
  tree_dump: object
}

export interface VaultBuilderSummary {
  vault_id: string
  epoch_number: number
  merkle_root: string
  wallets_included: number
  total_payout_usdc: number
  total_usdc_wei: string
  next_epoch_created: boolean
  deadline: string
}

// ---------------------------------------------------------------------------
// usdcToWei — convert USDC float to raw integer units (6 decimals)
// ---------------------------------------------------------------------------

function usdcToWei(usdcAmount: number): bigint {
  // Round to 6 decimal places first to avoid floating point dust
  const rounded = Math.round(usdcAmount * 1e6)
  return BigInt(rounded)
}

// ---------------------------------------------------------------------------
// buildVaultMerkleTree
// ---------------------------------------------------------------------------

export function buildVaultMerkleTree(
  entries: VaultDistributionEntry[]
): VaultMerkleResult {
  if (entries.length === 0) {
    throw new Error('[vaultMerkleBuilder] Cannot build Merkle tree with 0 entries')
  }

  const weiAmounts = entries.map((e) => ({
    wallet: e.wallet.toLowerCase(),
    usdc_amount_wei: usdcToWei(e.payout_usdc),
  }))

  // Build StandardMerkleTree — leaf: [address, uint256]
  const tree = StandardMerkleTree.of(
    weiAmounts.map((w) => [w.wallet, w.usdc_amount_wei.toString()]),
    ['address', 'uint256']
  )

  // Extract proofs per wallet
  const proofMap = new Map<string, string[]>()
  for (const [i, [wallet]] of tree.entries()) {
    proofMap.set((wallet as string).toLowerCase(), tree.getProof(i))
  }

  const leaves: VaultMerkleLeaf[] = weiAmounts.map((w) => ({
    wallet: w.wallet,
    usdc_amount_wei: w.usdc_amount_wei.toString(),
    proof: proofMap.get(w.wallet) ?? [],
  }))

  const total_usdc_wei = weiAmounts
    .reduce((sum, w) => sum + w.usdc_amount_wei, 0n)
    .toString()

  return {
    root: tree.root,
    leaves,
    total_usdc_wei,
    tree_dump: tree.dump(),
  }
}

// ---------------------------------------------------------------------------
// commitVaultDistribution — writes Merkle results to vault_epochs and opens next epoch
//
// Write order (all via Supabase REST — no multi-table transaction):
//   1. Update vault_epochs: merkle_root, tree_json, deadline, status='published'
//   2. Insert next vault_epochs row: status='active', epoch_number+1
//
// If any step fails the cron detects 'settling' epochs and retries.
// ---------------------------------------------------------------------------

const EPOCH_DURATION_DAYS = 7
const CLAIM_DEADLINE_DAYS = 90

export async function commitVaultDistribution(
  epochId: string,
  vaultId: string,
  epochNumber: number,
  processorResult: VaultEpochProcessorResult,
  merkleResult: VaultMerkleResult
): Promise<VaultBuilderSummary> {
  const supabase = createSupabaseServiceClient()
  const now      = new Date().toISOString()

  // 90-day claim deadline from epoch close time
  const deadline = new Date(
    Date.now() + CLAIM_DEADLINE_DAYS * 86_400_000
  ).toISOString()

  // 1. Publish merkle root to current epoch
  const { error: updateErr } = await supabase
    .from('vault_epochs')
    .update({
      merkle_root:   merkleResult.root,
      tree_json:     merkleResult.tree_dump,
      deadline,
      status:        'published',
      total_claimed: 0,
      updated_at:    now,
    })
    .eq('id', epochId)
    .eq('status', 'settling')   // guard: only update if still in settling state

  if (updateErr) {
    throw new Error(`[vaultMerkleBuilder] vault_epochs update failed: ${updateErr.message}`)
  }

  // 2. Open next epoch
  const nextEpochStart = new Date()
  const nextEpochEnd   = new Date(
    nextEpochStart.getTime() + EPOCH_DURATION_DAYS * 86_400_000
  )

  const { error: nextEpochErr } = await supabase
    .from('vault_epochs')
    .insert({
      vault_id:      vaultId,
      epoch_number:  epochNumber + 1,
      total_pool:    0,
      bonus_pool:    0,
      total_claimed: 0,
      status:        'active',
      created_at:    now,
      updated_at:    now,
    })

  let next_epoch_created = false
  if (nextEpochErr) {
    // Non-fatal: epoch was published successfully. Next epoch may already exist
    // (e.g. a previous partial run created it). Log and continue.
    console.error(
      `[vaultMerkleBuilder] next epoch insert error for vault=${vaultId} epoch=${epochNumber + 1}: ` +
      nextEpochErr.message
    )
  } else {
    next_epoch_created = true
  }

  return {
    vault_id:            vaultId,
    epoch_number:        epochNumber,
    merkle_root:         merkleResult.root,
    wallets_included:    merkleResult.leaves.length,
    total_payout_usdc:   processorResult.total_payout_usdc,
    total_usdc_wei:      merkleResult.total_usdc_wei,
    next_epoch_created,
    deadline,
  }
}

// ---------------------------------------------------------------------------
// runVaultMerkleBuilder — orchestrates build + commit for one vault epoch
// Called by the vault-epoch-close cron after processVaultEpoch() returns.
// ---------------------------------------------------------------------------

export async function runVaultMerkleBuilder(
  epochId: string,
  vaultId: string,
  epochNumber: number,
  processorResult: VaultEpochProcessorResult
): Promise<VaultBuilderSummary> {
  if (processorResult.entries.length === 0) {
    throw new Error(
      `[vaultMerkleBuilder] No eligible LP entries for vault=${vaultId} epoch=${epochNumber}. ` +
      `${processorResult.wallets_excluded_zero_deposit} deposits with zero balance were excluded.`
    )
  }

  const merkleResult = buildVaultMerkleTree(processorResult.entries)
  return commitVaultDistribution(epochId, vaultId, epochNumber, processorResult, merkleResult)
}

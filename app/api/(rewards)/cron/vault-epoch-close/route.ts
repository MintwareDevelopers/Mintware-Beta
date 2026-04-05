// =============================================================================
// GET /api/cron/vault-epoch-close
//
// Vault epoch close cron. Runs weekly at Monday 00:00 UTC.
//
// vercel.json schedule: "0 0 * * 1"
//
// Authorization: Bearer <CRON_SECRET>
//
// Per-epoch flow:
//   1. Mark vault_epochs.status = 'settling' (prevents double-processing)
//   2. Load all active lp_deposits for the vault
//   3. Call processVaultEpoch() → LP distribution list with USDC payouts
//   4. Call runVaultMerkleBuilder() → builds tree, writes merkle_root to vault_epochs
//   5. vault_epochs advances to 'published', next epoch created with status='active'
//
// On error:
//   - Revert vault_epochs.status to 'active' for next weekly retry
//   - Stuck-settling detection: epochs in 'settling' for > 2 hours are flagged in logs
//
// Fee pool:
//   - vault_epochs.total_pool is accumulated by FeeVault.sol (MEV capture fees + early-exit penalties)
//   - vault_epochs.bonus_pool is the Attribution bonus (5% of total pool, seeded by protocol)
//   - Combined = total_pool + bonus_pool → distributed to LPs weighted by score
//   - Referrer pool (15% of fees) and protocol pool (10%) are settled separately
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http, parseAbi } from 'viem'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { processVaultEpoch } from '@/lib/rewards/vault/vaultEpochProcessor'
import { runVaultMerkleBuilder } from '@/lib/rewards/vault/vaultMerkleBuilder'
import type { LockTier } from '@/lib/web2/vault/types'

export const maxDuration = 300  // 5 min — Vercel Pro cron max

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VaultEpochRow {
  id: string
  vault_id: string
  epoch_number: number
  total_pool: number
  bonus_pool: number
  total_claimed: number
  status: string
  created_at: string
  updated_at: string
}

interface OnchainEpochState {
  totalAccumulated: bigint
  bonusPool: bigint
}

interface LpDepositRow {
  id: string
  wallet: string
  usdc_amount: number
  lock_tier: LockTier
  deposited_at: string
  compounded_amount: number
  status: string
}

const FEE_VAULT_ABI = parseAbi([
  'function getEpoch(uint256 epochId) view returns ((uint256 totalAccumulated,uint256 bonusPool,uint256 totalAllocated,uint256 totalClaimed,uint256 openedAt,uint256 closedAt,uint256 deadline,bool closed,bool swept,bytes32 merkleRoot))',
])

function getFeeVaultAddress(): `0x${string}` | null {
  const raw = process.env.FEE_VAULT_ADDRESS ?? process.env.NEXT_PUBLIC_FEE_VAULT_ADDRESS
  if (!raw?.startsWith('0x')) return null
  return raw as `0x${string}`
}

function getBaseRpcUrl(): string {
  return process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'
}

async function readOnchainEpochState(epochNumber: number): Promise<OnchainEpochState | null> {
  const feeVault = getFeeVaultAddress()
  if (!feeVault) return null

  const publicClient = createPublicClient({
    transport: http(getBaseRpcUrl()),
  })

  const epoch = await publicClient.readContract({
    address: feeVault,
    abi: FEE_VAULT_ABI,
    functionName: 'getEpoch',
    args: [BigInt(epochNumber)],
  })

  return {
    totalAccumulated: epoch.totalAccumulated,
    bonusPool: epoch.bonusPool,
  }
}

// ---------------------------------------------------------------------------
// processExpiredVaultEpoch — processes a single vault epoch end-to-end
// ---------------------------------------------------------------------------

async function processExpiredVaultEpoch(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  epoch: VaultEpochRow,
  appBaseUrl: string,
  readyEpochCount: number
): Promise<{ epoch_number: number; vault_id: string; result: object } | { epoch_number: number; vault_id: string; error: string }> {
  const { vault_id, epoch_number } = epoch

  // 1. Atomically claim this epoch for processing: active → settling
  // If another instance already claimed it, this update matches 0 rows → skip.
  const { data: claimed, error: claimErr } = await supabase
    .from('vault_epochs')
    .update({ status: 'settling', updated_at: new Date().toISOString() })
    .eq('id', epoch.id)
    .eq('status', 'active')   // ← only update if still 'active'
    .select('id')
    .maybeSingle()

  if (claimErr) {
    return { epoch_number, vault_id, error: `claim failed: ${claimErr.message}` }
  }
  if (!claimed) {
    return { epoch_number, vault_id, error: 'already claimed by another instance' }
  }

  try {
    // 2. Load all active LP deposits for this vault
    const { data: deposits, error: depErr } = await supabase
      .from('lp_deposits')
      .select('id, wallet, usdc_amount, lock_tier, deposited_at, compounded_amount, status')
      .eq('vault_id', vault_id)
      .in('status', ['active', 'withdrawal_pending'])  // include withdrawal_pending: they still held funds this epoch

    if (depErr) {
      throw new Error(`lp_deposits load failed: ${depErr.message}`)
    }

    const depositList: LpDepositRow[] = deposits ?? []

    // The distribution pool = trading fees + MEV capture + bonus (Attribution).
    // Prefer on-chain FeeVault state when we have a single global vault config.
    let mirroredTotalPool = epoch.total_pool ?? 0
    let mirroredBonusPool = epoch.bonus_pool ?? 0

    const feeVaultAddress = getFeeVaultAddress()
    if (feeVaultAddress) {
      if (readyEpochCount > 1) {
        throw new Error(
          'Multiple vault epochs are ready to close, but only a single global FEE_VAULT_ADDRESS is configured. ' +
          'Refusing to guess per-vault pool attribution.'
        )
      }

      const onchainEpoch = await readOnchainEpochState(epoch_number)
      if (!onchainEpoch) {
        throw new Error('Unable to read FeeVault epoch state')
      }

      mirroredTotalPool = Number(onchainEpoch.totalAccumulated) / 1e6
      mirroredBonusPool = Number(onchainEpoch.bonusPool) / 1e6

      await supabase
        .from('vault_epochs')
        .update({
          total_pool: mirroredTotalPool,
          bonus_pool: mirroredBonusPool,
          updated_at: new Date().toISOString(),
        })
        .eq('id', epoch.id)
        .eq('status', 'settling')
    } else if ((mirroredTotalPool + mirroredBonusPool) <= 0) {
      throw new Error(
        'vault_epochs pool mirror is empty and no FEE_VAULT_ADDRESS is configured for on-chain reconciliation'
      )
    }

    const totalPoolUsdc = mirroredTotalPool + mirroredBonusPool

    // If there are no deposits OR no fee pool has accumulated, mark complete with no distribution
    if (depositList.length === 0 || totalPoolUsdc <= 0) {
      await supabase
        .from('vault_epochs')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('id', epoch.id)

      // Open next epoch regardless
      await supabase
        .from('vault_epochs')
        .insert({
          vault_id,
          epoch_number:  epoch_number + 1,
          total_pool:    0,
          bonus_pool:    0,
          total_claimed: 0,
          status:        'active',
          created_at:    new Date().toISOString(),
          updated_at:    new Date().toISOString(),
        })

      return {
        epoch_number,
        vault_id,
        result: {
          skipped: true,
          reason: depositList.length === 0 ? 'no_lp_deposits' : 'zero_fee_pool',
          deposits: depositList.length,
          total_pool_usdc: totalPoolUsdc,
        },
      }
    }

    // 3. Compute LP distribution — weighted by usdc × tier × duration × attribution
    const processorResult = await processVaultEpoch(
      vault_id,
      epoch_number,
      totalPoolUsdc,
      depositList.map((d) => ({
        id:                 d.id,
        wallet:             d.wallet,
        usdc_amount:        d.usdc_amount,
        lock_tier:          d.lock_tier,
        deposited_at:       d.deposited_at,
        compounded_amount:  d.compounded_amount ?? 0,
      })),
      appBaseUrl
    )

    // Edge: all deposits had 0 USDC (shouldn't happen — log and skip gracefully)
    if (processorResult.entries.length === 0) {
      await supabase
        .from('vault_epochs')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('id', epoch.id)

      return {
        epoch_number,
        vault_id,
        result: {
          skipped: true,
          reason:   'all_deposits_zero_balance',
          excluded: processorResult.wallets_excluded_zero_deposit,
        },
      }
    }

    // 4. Build Merkle tree and commit to vault_epochs
    const summary = await runVaultMerkleBuilder(
      epoch.id,
      vault_id,
      epoch_number,
      processorResult
    )

    console.log(
      `[vault-epoch-close] ✓ published: vault=${vault_id} epoch=${epoch_number} ` +
      `root=${summary.merkle_root.slice(0, 12)}... ` +
      `wallets=${summary.wallets_included} ` +
      `total_usdc=${processorResult.total_payout_usdc.toFixed(6)} ` +
      `deadline=${summary.deadline}`
    )

    return {
      epoch_number,
      vault_id,
      result: {
        ...summary,
        merkle_root: summary.merkle_root.slice(0, 12) + '...',  // truncate for log safety
      },
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[vault-epoch-close] vault=${vault_id} epoch=${epoch_number} failed:`, message)

    // Revert to 'active' so the next weekly cron run retries
    await supabase
      .from('vault_epochs')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', epoch.id)
      .eq('status', 'settling')   // only revert if still settling

    return { epoch_number, vault_id, error: message }
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // Auth — same pattern as epoch-end and pool-settle crons
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'CRON_SECRET not set — refusing to run outside local development without auth' },
      { status: 500 }
    )
  }

  const startedAt = Date.now()
  const now = new Date().toISOString()
  console.log('[vault-epoch-close] cron started at', now)

  const supabase = createSupabaseServiceClient()

  // App base URL for internal attribution-snapshot calls
  // Falls back to localhost for development
  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  // ── Detect stuck-settling epochs ────────────────────────────────────────
  // Vault epochs stuck in 'settling' for more than 2 hours indicate a failed run.
  const stuckThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: stuckEpochs } = await supabase
    .from('vault_epochs')
    .select('id, vault_id, epoch_number, updated_at')
    .eq('status', 'settling')
    .lt('updated_at', stuckThreshold)

  if (stuckEpochs && stuckEpochs.length > 0) {
    for (const e of stuckEpochs) {
      console.warn(
        `[vault-epoch-close] ⚠ STUCK EPOCH: vault=${e.vault_id} epoch=${e.epoch_number} ` +
        `has been in 'settling' since ${e.updated_at} — manual investigation required`
      )
    }
  }

  // ── Find active epochs ready to close ────────────────────────────────────
  // Close epochs that have been active for >= 7 days.
  // Uses created_at rather than a separate closes_at column to avoid schema changes.
  // A closes_at column would be more explicit — consider adding in a future migration.
  const epochCloseThreshold = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data: readyEpochs, error: queryErr } = await supabase
    .from('vault_epochs')
    .select('*')
    .eq('status', 'active')
    .lt('created_at', epochCloseThreshold)  // active for >= 7 days

  if (queryErr) {
    console.error('[vault-epoch-close] query failed:', queryErr.message)
    return NextResponse.json({ ok: false, error: queryErr.message }, { status: 500 })
  }

  const epochs: VaultEpochRow[] = readyEpochs ?? []

  if (epochs.length === 0) {
    return NextResponse.json({
      ok: true,
      epochs_processed: 0,
      message: 'no vault epochs ready to close',
      duration_ms: Date.now() - startedAt,
    })
  }

  console.log(`[vault-epoch-close] found ${epochs.length} vault epoch(s) ready to close`)

  // Process each expired epoch sequentially
  // Sequential: each epoch makes multiple DB writes + attribution API calls.
  // Parallelism risks DB contention and Attribution API rate limits.
  const results = []
  for (const epoch of epochs) {
    console.log(
      `[vault-epoch-close] processing vault=${epoch.vault_id} epoch=#${epoch.epoch_number} ` +
      `pool=${((epoch.total_pool ?? 0) + (epoch.bonus_pool ?? 0)).toFixed(6)} USDC`
    )
    const result = await processExpiredVaultEpoch(supabase, epoch, appBaseUrl, epochs.length)
    results.push(result)
  }

  const succeeded = results.filter((r) => !('error' in r))
  const failed    = results.filter((r) => 'error' in r)

  const durationMs = Date.now() - startedAt
  console.log(
    `[vault-epoch-close] complete: ${succeeded.length} ok, ${failed.length} failed, ${durationMs}ms`
  )

  return NextResponse.json({
    ok:               failed.length === 0,
    epochs_found:     epochs.length,
    epochs_succeeded: succeeded.length,
    epochs_failed:    failed.length,
    results,
    duration_ms:      durationMs,
  })
}

export async function POST() {
  return NextResponse.json({ error: 'method not allowed — use GET' }, { status: 405 })
}

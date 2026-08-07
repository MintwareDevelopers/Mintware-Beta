// =============================================================================
// vaultEpochProcessor.ts — Vault LP epoch distribution calculator
// T2.4: Vault epoch close automation
//
// Computes the USDC payout per LP for a vault epoch close.
//
// Weight formula:
//   raw_weight  = usdc_amount × tier_mult × duration_mult × attr_mult
//   LP share    = raw_weight / sum(all raw_weights)
//   LP payout   = total_pool × LP share
//
// Multiplier sources:
//   - tier_mult:     lock tier (flex=1.0, committed=1.1, aligned=1.25, core=1.5)
//   - duration_mult: time elapsed since deposit (<30d=1.0, 30-90d=1.1, 90-180d=1.2, ≥180d=1.3)
//   - attr_mult:     Attribution percentile (0-33%=1.0, 34-66%=1.25, 67-100%=1.5)
//
// Attribution snapshots are fetched via the internal oracle route (off-chain, no gas).
// Wallets that fail attribution fetch fall back to 1.0× — never blocked.
//
// Does NOT write to the database — returns the distribution list.
// Writing is handled by vaultMerkleBuilder.
// =============================================================================

import type { LockTier } from '@/lib/web2/vault/types'
import { CRON_SECRET } from '@/lib/constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultLpDeposit {
  id: string
  wallet: string
  usdc_amount: number      // deposited USDC, principal only
  lock_tier: LockTier
  deposited_at: string     // ISO timestamp
  compounded_amount: number
}

export interface VaultDistributionEntry {
  wallet: string
  usdc_deposited: number
  lock_tier: LockTier
  tier_multiplier: number
  duration_multiplier: number
  attr_multiplier: number
  combined_multiplier: number
  raw_weight: number       // usdc × combined_mult
  share: number            // raw_weight / total_weight
  payout_usdc: number      // share × total_pool
}

export interface VaultEpochProcessorResult {
  vault_id: string
  epoch_number: number
  total_pool_usdc: number
  total_weight: number
  entries: VaultDistributionEntry[]
  total_payout_usdc: number
  wallets_excluded_zero_deposit: number
}

// ---------------------------------------------------------------------------
// Lock tier multipliers
// Matches SocialVault.sol LockTier enum ordering (0=Flex, 1=Committed, 2=Aligned, 3=Core)
// ---------------------------------------------------------------------------

const TIER_MULTIPLIER: Record<LockTier, number> = {
  flex:      1.0,
  committed: 1.1,
  aligned:   1.25,
  core:      1.5,
}

// ---------------------------------------------------------------------------
// Duration multiplier — days since deposit
// ---------------------------------------------------------------------------

export function durationMultiplier(depositedAt: string): number {
  const days = (Date.now() - new Date(depositedAt).getTime()) / 86_400_000
  if (days >= 180) return 1.3
  if (days >= 90)  return 1.2
  if (days >= 30)  return 1.1
  return 1.0
}

// ---------------------------------------------------------------------------
// Attribution multiplier — percentile band
// ---------------------------------------------------------------------------

export function attrMultiplier(percentile: number): number {
  if (percentile >= 67) return 1.5
  if (percentile >= 34) return 1.25
  return 1.0
}

// ---------------------------------------------------------------------------
// Attribution snapshot fetching
//
// Calls GET /api/vault/attribution-snapshot?vault_id=&wallet= (oracle route).
// Concurrency limited to 5 simultaneous calls — avoids hammering Attribution API.
// Failures fall back to 1.0× multiplier (non-fatal).
// ---------------------------------------------------------------------------

const ATTR_FETCH_CONCURRENCY = 5

interface AttrSnapshotResponse {
  percentile: number
  attr_multiplier?: number
  combined_multiplier_bps?: number
}

async function fetchAttrPercentile(
  vaultId: string,
  wallet: string,
  baseUrl: string
): Promise<number> {
  try {
    const url = `${baseUrl}/api/vault/attribution-snapshot?vault_id=${encodeURIComponent(vaultId)}&wallet=${wallet}`
    // The snapshot route is bearer-gated (it signs with the oracle key) — forward
    // the cron secret so this server-side call authenticates.
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return 0
    const data = await res.json() as AttrSnapshotResponse
    return data.percentile ?? 0
  } catch {
    return 0  // non-fatal — fall back to 1.0× tier
  }
}

/** Runs an async function over an array with a concurrency cap */
async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// processVaultEpoch — main export
//
// Accepts the vault id, epoch data, and all active LP deposits for the vault.
// Returns the full distribution list — does NOT write to DB.
// ---------------------------------------------------------------------------

export async function processVaultEpoch(
  vaultId: string,
  epochNumber: number,
  totalPoolUsdc: number,
  deposits: VaultLpDeposit[],
  baseUrl: string   // e.g. process.env.NEXT_PUBLIC_APP_URL or 'http://localhost:3000'
): Promise<VaultEpochProcessorResult> {
  // Only deposits with a positive USDC amount are eligible
  const eligible = deposits.filter((d) => d.usdc_amount > 0)
  const excluded = deposits.length - eligible.length

  if (eligible.length === 0 || totalPoolUsdc <= 0) {
    return {
      vault_id: vaultId,
      epoch_number: epochNumber,
      total_pool_usdc: totalPoolUsdc,
      total_weight: 0,
      entries: [],
      total_payout_usdc: 0,
      wallets_excluded_zero_deposit: excluded,
    }
  }

  // Fetch Attribution percentiles for all eligible LPs
  const percentiles = await withConcurrency(
    eligible,
    ATTR_FETCH_CONCURRENCY,
    (d) => fetchAttrPercentile(vaultId, d.wallet, baseUrl)
  )

  // Build distribution entries
  const entries: VaultDistributionEntry[] = eligible.map((d, i) => {
    const tierMult     = TIER_MULTIPLIER[d.lock_tier] ?? 1.0
    const durMult      = durationMultiplier(d.deposited_at)
    const attrMult     = attrMultiplier(percentiles[i])
    // Combined multiplier, capped at 1.95×
    const combined     = Math.min(Math.round(tierMult * durMult * attrMult * 1000) / 1000, 1.95)
    // Include compounded amount in the weight base (compounded USDC earns too)
    const totalUsdc    = d.usdc_amount + d.compounded_amount
    const rawWeight    = totalUsdc * combined

    return {
      wallet:               d.wallet.toLowerCase(),
      usdc_deposited:       totalUsdc,
      lock_tier:            d.lock_tier,
      tier_multiplier:      tierMult,
      duration_multiplier:  durMult,
      attr_multiplier:      attrMult,
      combined_multiplier:  combined,
      raw_weight:           rawWeight,
      share:                0,       // filled below
      payout_usdc:          0,       // filled below
    }
  })

  const totalWeight = entries.reduce((sum, e) => sum + e.raw_weight, 0)

  // Compute shares and payouts
  for (const entry of entries) {
    entry.share       = totalWeight > 0 ? entry.raw_weight / totalWeight : 0
    entry.payout_usdc = Math.round(totalPoolUsdc * entry.share * 1e6) / 1e6
  }

  // Sort descending by payout for deterministic Merkle ordering
  entries.sort((a, b) => b.payout_usdc - a.payout_usdc)

  const totalPayoutUsdc = Math.round(
    entries.reduce((sum, e) => sum + e.payout_usdc, 0) * 1e6
  ) / 1e6

  // Sanity check: rounding error > 0.1% is unexpected
  if (totalPayoutUsdc > totalPoolUsdc * 1.001) {
    console.warn(
      `[vaultEpochProcessor] over-distribution: vault=${vaultId} epoch=${epochNumber} ` +
      `pool=${totalPoolUsdc.toFixed(6)} payout=${totalPayoutUsdc.toFixed(6)}`
    )
  }

  return {
    vault_id: vaultId,
    epoch_number: epochNumber,
    total_pool_usdc: totalPoolUsdc,
    total_weight: totalWeight,
    entries,
    total_payout_usdc: totalPayoutUsdc,
    wallets_excluded_zero_deposit: excluded,
  }
}

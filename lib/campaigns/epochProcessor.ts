// =============================================================================
// epochProcessor.ts — Epoch end calculation
// Ticket 4: Epoch distribution
//
// Triggered when epoch_end < NOW() and epoch_state.status = 'active'.
// Fetches fresh Attribution + Sharing scores per participant wallet,
// applies the combined multiplier, and computes payout_usd per wallet.
//
// Formula (from mintware_campaign_logic_model.docx §3):
//   wallet_share     = wallet_points / total_points
//   wallet_payout    = epoch_pool_usd × wallet_share × combined_multiplier
//
// Note: combined_multiplier > 1.0 means total distributed > epoch_pool_usd.
// This is intentional — sponsorship fee covers the buffer (per spec §3).
//
// Does NOT write to the database — returns the distribution list.
// Writing is handled by the epoch-end cron after merkleBuilder completes.
// =============================================================================

import { API } from '@/lib/api'
import type { Campaign, Participant, ScoreMultipliers } from '@/lib/campaigns/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreProfile {
  wallet: string
  attribution_score: number
  attribution_percentile: number   // 0–100 from API
  sharing_score: number            // raw signal score (0–125 max)
}

export interface DistributionEntry {
  wallet: string
  points: number
  attribution_percentile: number
  sharing_score: number
  multipliers: ScoreMultipliers
  payout_usd: number
}

export interface EpochProcessorResult {
  campaign_id: string
  epoch_number: number
  epoch_pool_usd: number
  total_points: number
  entries: DistributionEntry[]         // one per wallet with points > 0
  total_payout_usd: number             // sum of all payouts (may exceed epoch_pool_usd)
  wallets_excluded_zero_points: number // wallets with 0 points, excluded from distribution
}

// ---------------------------------------------------------------------------
// Score multiplier calculation
//
// Source: mintware_campaign_logic_model.docx §3
// Multiplier is based on percentile / score fraction, not raw score.
//
// Attribution: uses API-provided percentile (network-relative rank)
// Sharing: computed as (sharing_score / 125) * 100 → percentage of max
//   125 is the max Sharing signal score (from CLAUDE.md signal table)
//   This is a proxy for sharing percentile since the API doesn't return one.
// ---------------------------------------------------------------------------
const SHARING_SCORE_MAX = 125

export function computeMultipliers(
  attribution_percentile: number,
  sharing_score: number
): ScoreMultipliers {
  const sharing_pct = Math.min(100, (sharing_score / SHARING_SCORE_MAX) * 100)

  const attribution: number =
    attribution_percentile >= 67 ? 1.5
    : attribution_percentile >= 34 ? 1.25
    : 1.0

  const sharing: number =
    sharing_pct >= 67 ? 1.3
    : sharing_pct >= 34 ? 1.15
    : 1.0

  return {
    attribution,
    sharing,
    combined: Math.round(attribution * sharing * 1000) / 1000,  // round to 3dp
  }
}

// ---------------------------------------------------------------------------
// Attribution API score fetching
//
// Calls GET /score?address= for each participant.
// Concurrency limited to 5 simultaneous requests — avoids hammering the worker.
// Wallets that fail score fetch fall back to the cached score in participants table.
// ---------------------------------------------------------------------------
const SCORE_FETCH_CONCURRENCY = 5

interface ApiScoreResponse {
  score: number
  percentile: number
  signals?: Array<{ key: string; score: number }>
}

async function fetchScoreProfile(wallet: string): Promise<ApiScoreResponse | null> {
  try {
    const res = await fetch(`${API}/score?address=${wallet}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),  // 8s timeout per wallet
    })
    if (!res.ok) return null
    return await res.json() as ApiScoreResponse
  } catch {
    return null
  }
}

/** Runs an async function over an array with a max concurrency cap */
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

async function fetchAllScores(participants: Participant[]): Promise<Map<string, ScoreProfile>> {
  const profiles = await withConcurrency(
    participants,
    SCORE_FETCH_CONCURRENCY,
    async (p) => {
      const apiData = await fetchScoreProfile(p.wallet)

      const sharing_score =
        apiData?.signals?.find((s) => s.key === 'sharing')?.score
        ?? p.sharing_score  // fall back to cached value

      return {
        wallet: p.wallet.toLowerCase(),
        attribution_score: apiData?.score ?? p.attribution_score,
        attribution_percentile: apiData?.percentile ?? 0,
        sharing_score,
      } satisfies ScoreProfile
    }
  )

  const map = new Map<string, ScoreProfile>()
  for (const profile of profiles) {
    map.set(profile.wallet, profile)
  }
  return map
}

// ---------------------------------------------------------------------------
// processEpoch — main export
//
// Accepts a campaign, its epoch_state row, and all participants.
// Returns the full distribution list — does NOT write to DB.
// ---------------------------------------------------------------------------

interface EpochState {
  id: string
  campaign_id: string
  epoch_number: number
  epoch_pool_usd: number
  total_points: number
}

export async function processEpoch(
  campaign: Campaign,
  epoch: EpochState,
  participants: Participant[]
): Promise<EpochProcessorResult> {
  // Only participants who actually earned points this epoch
  const eligible = participants.filter((p) => p.total_points > 0)
  const excluded = participants.length - eligible.length

  if (eligible.length === 0) {
    return {
      campaign_id: campaign.id,
      epoch_number: epoch.epoch_number,
      epoch_pool_usd: epoch.epoch_pool_usd,
      total_points: epoch.total_points,
      entries: [],
      total_payout_usd: 0,
      wallets_excluded_zero_points: excluded,
    }
  }

  // Use epoch.total_points as the denominator — this is the authoritative sum
  // maintained atomically by increment_epoch_points() RPC throughout the epoch.
  const total_points = epoch.total_points > 0
    ? epoch.total_points
    : eligible.reduce((sum, p) => sum + p.total_points, 0)

  if (total_points === 0) {
    return {
      campaign_id: campaign.id,
      epoch_number: epoch.epoch_number,
      epoch_pool_usd: epoch.epoch_pool_usd,
      total_points: 0,
      entries: [],
      total_payout_usd: 0,
      wallets_excluded_zero_points: excluded,
    }
  }

  // Fetch fresh Attribution + Sharing scores for all eligible participants
  const scoreMap = await fetchAllScores(eligible)

  // Build distribution entries
  const entries: DistributionEntry[] = []

  for (const participant of eligible) {
    const wallet = participant.wallet.toLowerCase()
    const profile = scoreMap.get(wallet)

    const attribution_percentile = profile?.attribution_percentile ?? 0
    const sharing_score = profile?.sharing_score ?? participant.sharing_score

    const multipliers = computeMultipliers(attribution_percentile, sharing_score)

    const wallet_share = participant.total_points / total_points
    const payout_usd = epoch.epoch_pool_usd * wallet_share * multipliers.combined

    entries.push({
      wallet,
      points: participant.total_points,
      attribution_percentile,
      sharing_score,
      multipliers,
      payout_usd: Math.round(payout_usd * 1e6) / 1e6,  // 6dp precision
    })
  }

  // Sort descending by payout for deterministic ordering in Merkle tree
  entries.sort((a, b) => b.payout_usd - a.payout_usd)

  const total_payout_usd = entries.reduce((sum, e) => sum + e.payout_usd, 0)

  return {
    campaign_id: campaign.id,
    epoch_number: epoch.epoch_number,
    epoch_pool_usd: epoch.epoch_pool_usd,
    total_points,
    entries,
    total_payout_usd: Math.round(total_payout_usd * 1e6) / 1e6,
    wallets_excluded_zero_points: excluded,
  }
}

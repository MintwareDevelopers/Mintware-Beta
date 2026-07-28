// =============================================================================
// RWA Incentive Layer · R4 (hold-snapshot credit) + R5 (duration-match bonus)
//
// The one net-new engine mechanic. DeFi campaigns credit per swap *tx*; RWA
// subscription/hold campaigns credit per *epoch holding*:
//
//   hold_points = rate × vRWA_held × duration_days × attribution_mult × durationMatch
//
// This module is deliberately split:
//   • computeHoldPoints / durationMatchMultiplier — PURE, fully unit-tested. This
//     is the correctness-critical math and has no I/O.
//   • processHoldSnapshot — the DB writer. Per wallet it calls the atomic
//     `credit_hold_points` RPC (guard-insert + participant-increment in one tx,
//     idempotent via ON CONFLICT), then bumps the epoch accumulator once.
//
// The cron adapter (app/api/(rewards)/cron/rwa-hold-snapshot) sources balances and
// lock durations (on-chain, per vault) and feeds them in — keeping this pure.
//
// See docs/developers/rwa-incentive-layer.md §4.1 (hold-snapshot) + §4.2 (duration-match).
// Permissionless by construction — NO eligibility check here (§3.0).
// =============================================================================

import { computeMultipliers } from './epochProcessor'
import { getActionPoints, type Campaign } from './types'

/** Attribution's max composite score, matching swapHook's percentile proxy. */
const ATTRIBUTION_SCORE_MAX = 925

/** Fallback base rate: points per 1 unit of vRWA held per day when a campaign
 *  does not configure `actions.hold.points`. Campaigns tune this per deal. */
export const DEFAULT_HOLD_RATE = 1

/** Multiplier applied when a wallet's lock covers the asset's required duration (R5). */
export const DURATION_MATCH_BONUS = 1.5

export interface HoldInput {
  wallet: string
  /** vRWA held at snapshot, in human units (NAV-denominated). */
  balance: number
  attribution_score: number
  sharing_score: number
  /** Days the wallet's position is locked/committed (0 = flex, no lock). */
  lockDays: number
}

export interface HoldConfig {
  /** Points per unit of vRWA held per day. */
  pointsPerUnitPerDay: number
  /** Snapshot window in days (the epoch cadence). */
  durationDays: number
  /** Whether to apply the Attribution × Sharing multiplier. */
  useScoreMultiplier: boolean
  /** R5 — lock ≥ this many days earns the duration-match bonus. null/0 disables. */
  durationMatchDays: number | null
}

/**
 * R5 — duration-match bonus. A wallet whose lock covers the asset's required
 * duration (typically the deal's settle_days) earns a bonus; otherwise 1.0×.
 * Threshold model: below the requirement earns nothing extra — the incentive is
 * to match the SPV's capital-duration need, not to lock "a bit".
 */
export function durationMatchMultiplier(lockDays: number, requiredDays: number | null): number {
  if (!requiredDays || requiredDays <= 0) return 1.0
  return lockDays >= requiredDays ? DURATION_MATCH_BONUS : 1.0
}

/**
 * Pure hold-points math for a single wallet's snapshot. Deterministic, no I/O.
 * Returns integer points. Zero balance or non-positive duration → 0.
 */
export function computeHoldPoints(input: HoldInput, cfg: HoldConfig): number {
  if (input.balance <= 0 || cfg.durationDays <= 0 || cfg.pointsPerUnitPerDay <= 0) return 0

  let scoreMult = 1.0
  if (cfg.useScoreMultiplier) {
    const attPct = Math.min(100, (input.attribution_score / ATTRIBUTION_SCORE_MAX) * 100)
    scoreMult = computeMultipliers(attPct, input.sharing_score).combined
  }

  const durMatch = durationMatchMultiplier(input.lockDays, cfg.durationMatchDays)
  const raw = cfg.pointsPerUnitPerDay * input.balance * cfg.durationDays * scoreMult * durMatch
  return Math.round(raw)
}

/** Resolve a HoldConfig from a campaign row. */
export function holdConfigFromCampaign(campaign: Campaign): HoldConfig {
  return {
    pointsPerUnitPerDay: getActionPoints(campaign.actions?.['hold'], DEFAULT_HOLD_RATE),
    durationDays:        campaign.epoch_duration_days ?? 7,
    useScoreMultiplier:  campaign.use_score_multiplier ?? false,
    durationMatchDays:   campaign.duration_match_days ?? null,
  }
}

export interface HoldSnapshotResult {
  credited: number      // wallets newly credited this snapshot
  skipped: number       // zero-points or already-credited (idempotent re-run)
  totalPoints: number   // sum credited into the epoch
}

/**
 * Credit a full hold snapshot for one campaign+epoch. Per wallet, calls the atomic
 * `credit_hold_points` RPC (migration 20260728000003), which inserts the guard `activity`
 * row and increments the participant IN ONE TRANSACTION, keyed on the campaign-scoped unique
 * index `(campaign_id, tx_hash, wallet, action_type)`. Then bumps the epoch accumulator once
 * for the points actually credited this pass.
 *
 * Idempotent by construction: the RPC's `ON CONFLICT DO NOTHING` returns `false` when the
 * wallet was already credited for this campaign/epoch/date, so a re-run — or an ambiguous
 * post-commit RPC failure on a prior run — can NEVER double-credit, and the insert and the
 * increment can never diverge. The synthetic tx_hash keeps the campaign id embedded so a
 * legitimate cross-campaign insert never trips the pre-existing global
 * `(wallet, tx_hash, action_type)` index (left intact for the DeFi path).
 */
export async function processHoldSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  campaign: Campaign,
  epochNumber: number,
  snapshotDate: string,          // YYYY-MM-DD
  holdings: HoldInput[],
): Promise<HoldSnapshotResult> {
  const cfg = holdConfigFromCampaign(campaign)
  const txKey = `hold:${campaign.id}:${epochNumber}:${snapshotDate}`
  const recordedAt = `${snapshotDate}T00:00:00Z`

  let credited = 0
  let skipped = 0
  let totalPoints = 0

  for (const h of holdings) {
    const pts = computeHoldPoints(h, cfg)
    if (pts <= 0) { skipped++; continue }

    const { data: didCredit, error } = await supabase.rpc('credit_hold_points', {
      p_campaign_id: campaign.id,
      p_wallet:      h.wallet,
      p_tx_hash:     txKey,
      p_points:      pts,
      p_recorded_at: recordedAt,
    })
    // error → transient; skip and let the next run retry (the RPC is idempotent).
    // didCredit === false → already credited for this snapshot; skip.
    if (error || didCredit === false) { skipped++; continue }

    credited++
    totalPoints += pts
  }

  // Bump the epoch accumulator once for the points actually credited this pass, so the
  // payout-share denominator (epoch_state.total_points) tracks what participants received.
  if (totalPoints > 0) {
    await supabase.rpc('increment_epoch_points', {
      p_campaign_id: campaign.id,
      p_delta:       totalPoints,
    })
  }

  return { credited, skipped, totalPoints }
}

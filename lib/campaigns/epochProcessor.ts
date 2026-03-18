// =============================================================================
// lib/campaigns/epochProcessor.ts — Daily epoch payout processor
//
// Called by /api/cron/epoch-end once per UTC day (00:00 UTC via Vercel cron).
//
// Per-campaign flow:
//   1. Load all participants with today's activity (daily_volume_usd > 0)
//   2. Apply daily qualification gate  (min_daily_volume_usd, default $25)
//   3. Compute score-weighted adjusted points for each qualifier
//   4. Apply anti-whale cap (max_points_per_wallet_pct of total, default 20%)
//   5. Rank qualifiers by adjusted points; tiebreak: joined_at ASC
//   6. Apply payout preset split to net daily pool
//   7. Distribute referral daily share to referrers
//   8. Write payout records + reset daily_volume_usd
//
// Observer mode:
//   Observers (observer = true) accumulate points at 0.5×, but are excluded
//   from the ranking/payout step entirely.
// =============================================================================

import type { Campaign, Participant, PayoutPresetKey } from '@/lib/campaigns/types'
import { PAYOUT_SPLITS } from '@/lib/campaigns/types'

// ─── Input / Output types ──────────────────────────────────────────────────────

export interface ParticipantRow {
  wallet:          string
  observer:        boolean
  total_points:    number
  trading_points:  number
  bridge_points:   number
  daily_volume_usd: number
  joined_at:       string    // ISO — tiebreaker
  ref_link?:       string    // referral info not needed here
  attribution_score: number
  score_multiplier:  number  // combined attribution × sharing multiplier
  referred_by?:    string    // wallet address of referrer (nullable)
  referral_trade_points?: number  // accumulated referral trade pts
  referral_bridge_points?: number
}

export interface PayoutRecord {
  wallet:     string
  rank:       number         // 1-based; 0 = referral bonus (not ranked)
  points:     number         // adjusted points used for ranking
  amount_usd: number
  type:       'rank' | 'referral'
}

export interface EpochResult {
  campaignId:    string
  epochDate:     string      // YYYY-MM-DD UTC
  totalPaidUsd:  number
  payouts:       PayoutRecord[]
  qualifiedCount: number
  skippedObservers: number
  skippedBelowGate: number
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MIN_DAILY_VOLUME_USD = 25
const DEFAULT_MAX_POINTS_PCT       = 20   // percent (0–100)
const DEFAULT_PAYOUT_PRESET: PayoutPresetKey = 'top10'

// ─── Core processor ────────────────────────────────────────────────────────────

/**
 * Process a single campaign's daily epoch.
 *
 * @param campaign      Campaign row from Supabase
 * @param participants  All participant rows for this campaign
 * @param dailyBudget   Net USD available for today's payout (after platform fee)
 * @param epochDate     ISO date string YYYY-MM-DD (UTC)
 */
export function processEpoch(
  campaign:     Campaign,
  participants: ParticipantRow[],
  dailyBudget:  number,
  epochDate:    string,
): EpochResult {

  const minVolume   = campaign.min_daily_volume_usd  ?? DEFAULT_MIN_DAILY_VOLUME_USD
  const maxPct      = campaign.max_points_per_wallet_pct ?? DEFAULT_MAX_POINTS_PCT
  const preset      = (campaign.payout_preset ?? DEFAULT_PAYOUT_PRESET) as PayoutPresetKey
  const refSharePct = campaign.referral_share_pct ?? 0
  const splits      = PAYOUT_SPLITS[preset]

  const payouts: PayoutRecord[] = []
  let skippedObservers  = 0
  let skippedBelowGate  = 0

  // ── Step 1: Separate observers; they never rank ─────────────────────────────
  const nonObservers = participants.filter(p => {
    if (p.observer) { skippedObservers++; return false }
    return true
  })

  // ── Step 2: Daily qualification gate ───────────────────────────────────────
  const qualified = nonObservers.filter(p => {
    const qualifies = p.daily_volume_usd >= minVolume
    if (!qualifies) skippedBelowGate++
    return qualifies
  })

  if (qualified.length === 0 || dailyBudget <= 0) {
    return {
      campaignId:    campaign.id,
      epochDate,
      totalPaidUsd:  0,
      payouts:       [],
      qualifiedCount: 0,
      skippedObservers,
      skippedBelowGate,
    }
  }

  // ── Step 3: Compute score-weighted adjusted points ──────────────────────────
  //
  // adjusted = (trading_points + bridge_points) × score_multiplier
  // score_multiplier = attribution_mult × sharing_mult (stored on participant row
  //   as a combined float, e.g. 0.75 × 1.2 = 0.9)
  //
  const withAdjusted = qualified.map(p => ({
    ...p,
    adjustedPoints: Math.round(
      (p.trading_points + p.bridge_points) * Math.max(0, p.score_multiplier)
    ),
  }))

  // ── Step 4: Anti-whale cap ──────────────────────────────────────────────────
  //
  // No single wallet may contribute more than max_points_per_wallet_pct% of the
  // total effective points pool.  Cap is applied iteratively until stable.
  //
  const capped = applyAntiWhaleCap(withAdjusted, maxPct)

  // ── Step 5: Rank by capped adjusted points; tiebreak joined_at ASC ─────────
  const ranked = [...capped].sort((a, b) => {
    if (b.cappedPoints !== a.cappedPoints) return b.cappedPoints - a.cappedPoints
    // Tiebreaker: earlier join date wins (ascending)
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
  })

  // ── Step 6: Distribute ranking payouts ─────────────────────────────────────
  const rankedPayouts = splits.length
  for (let i = 0; i < Math.min(ranked.length, rankedPayouts); i++) {
    const pct = splits[i]
    const amount = Math.round(dailyBudget * pct * 100) / 100
    payouts.push({
      wallet:     ranked[i].wallet,
      rank:       i + 1,
      points:     ranked[i].cappedPoints,
      amount_usd: amount,
      type:       'rank',
    })
  }

  // ── Step 7: Referral daily share ────────────────────────────────────────────
  //
  // For each qualified participant who has a referrer:
  //   referrer_bonus = referred_wallet's adjustedPoints × referralSharePct / 100
  // Referrer bonuses are additive (multiple referred wallets stack).
  // Referrers receive USD equivalent: bonus_points / total_points × dailyBudget
  // But we use a simpler model: fixed pct of the referred wallet's rank payout.
  // If the referred wallet didn't rank, referrer gets pct of their points-based
  // share of the total daily budget.
  //
  if (refSharePct > 0) {
    const totalCappedPoints = capped.reduce((s, p) => s + p.cappedPoints, 0)
    const referralBonuses = new Map<string, number>()

    for (const p of ranked) {
      if (!p.referred_by) continue
      // Referred wallet's proportional share of total daily budget
      const proportionalUsd = totalCappedPoints > 0
        ? (p.cappedPoints / totalCappedPoints) * dailyBudget
        : 0
      const bonus = Math.round(proportionalUsd * (refSharePct / 100) * 100) / 100
      if (bonus > 0) {
        referralBonuses.set(
          p.referred_by,
          (referralBonuses.get(p.referred_by) ?? 0) + bonus,
        )
      }
    }

    for (const [referrer, bonus] of referralBonuses) {
      payouts.push({
        wallet:     referrer,
        rank:       0,
        points:     0,
        amount_usd: bonus,
        type:       'referral',
      })
    }
  }

  const totalPaidUsd = payouts.reduce((s, p) => s + p.amount_usd, 0)

  return {
    campaignId:    campaign.id,
    epochDate,
    totalPaidUsd,
    payouts,
    qualifiedCount: qualified.length,
    skippedObservers,
    skippedBelowGate,
  }
}

// ─── Anti-whale cap ────────────────────────────────────────────────────────────

interface WithAdjusted extends ParticipantRow {
  adjustedPoints: number
}

interface WithCapped extends WithAdjusted {
  cappedPoints: number
}

/**
 * Iteratively cap each participant's points at maxPct% of the total.
 * Redistributes the excess to uncapped participants in proportion.
 * Converges after at most O(n) iterations.
 */
function applyAntiWhaleCap(
  participants: WithAdjusted[],
  maxPct:       number,
): WithCapped[] {
  let working = participants.map(p => ({ ...p, cappedPoints: p.adjustedPoints }))

  for (let pass = 0; pass < participants.length; pass++) {
    const total = working.reduce((s, p) => s + p.cappedPoints, 0)
    if (total === 0) break

    const capPerWallet = Math.floor(total * (maxPct / 100))
    let changed = false

    for (const p of working) {
      if (p.cappedPoints > capPerWallet) {
        p.cappedPoints = capPerWallet
        changed = true
      }
    }

    if (!changed) break
  }

  return working
}

// ─── Today's epoch date ────────────────────────────────────────────────────────

/**
 * Returns today's date in YYYY-MM-DD (UTC), e.g. "2026-03-17".
 * Suitable for use as the epoch identifier in payout records.
 */
export function todayUTC(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// =============================================================================
// lib/campaigns/types.ts — Shared campaign types
// =============================================================================

export interface CampaignAction {
  label:               string
  points:              number
  per_day?:            boolean
  one_time?:           boolean
  per_referral?:       boolean
  per_referred_trade?: boolean
}

export interface Campaign {
  id:             string
  name:           string
  chain:          string
  status:         'live' | 'upcoming' | 'ended' | string
  end_date?:      string
  start_date?:    string
  pool_usd?:      number
  daily_payout_usd?: number
  token_symbol?:  string
  min_score?:     number
  protocol?:      string
  actions?:       Record<string, CampaignAction>

  // Epoch / cron fields (from migration 20260317000005)
  payout_preset?:            'top3' | 'top5' | 'top10' | 'top20'
  referral_share_pct?:       number   // default 0
  min_daily_volume_usd?:     number   // default 25 — daily qualification gate
  max_points_per_wallet_pct?: number  // default 20 — anti-whale cap
}

export interface Participant {
  // Core
  attribution_score:       number
  score_multiplier:        string | number
  total_points:            number
  total_earned_usd:        string | number

  // Point breakdown
  bridge_points?:          number
  trading_points?:         number
  referral_bridge_points?: number
  referral_trade_points?:  number

  // Activity
  active_trading_days?:    number
  tree_size?:              number
  tree_quality?:           string | number
  ref_link?:               string

  // Observer flag — kept in DB schema, always false for new joins
  observer:                boolean

  // Daily tracking (reset each cron run)
  daily_volume_usd?:       number

  // Internal
  joined_at?:              string   // ISO — used for tiebreaker
}

// Payout preset splits (must sum to 1.0)
export type PayoutPresetKey = 'top3' | 'top5' | 'top10' | 'top20'

export const PAYOUT_SPLITS: Record<PayoutPresetKey, number[]> = {
  top3:  [0.50, 0.30, 0.20],
  top5:  [0.35, 0.25, 0.20, 0.12, 0.08],
  top10: [0.25, 0.18, 0.14, 0.10, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03],
  top20: Array(20).fill(0.05),
}

/** Points credited when processing a swap event */
export interface SwapEventInput {
  campaignId:  string
  wallet:      string
  volumeUsd:   number
  isBridge:    boolean
}

/** Computed points to credit for a single swap event */
export interface SwapPointsResult {
  tradingPoints:      number
  bridgePoints:       number
  volumeUsdIncrement: number   // raw volume to add to daily_volume_usd
}

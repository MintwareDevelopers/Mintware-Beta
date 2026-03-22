// =============================================================================
// Campaign Engine — Type Definitions
// Source of truth: mintware_campaign_logic_model.docx
// =============================================================================

export type CampaignType = 'token_pool' | 'points'
export type CampaignStatus = 'upcoming' | 'live' | 'ended' | 'paused'
export type RewardType = 'buyer' | 'referrer' | 'platform_fee'
export type ActionType = 'bridge' | 'trade' | 'referral_bridge' | 'referral_trade'
export type DistributionStatus = 'pending' | 'published' | 'finalized'
export type PendingRewardStatus = 'locked' | 'claimable' | 'claimed' | 'expired'

// Campaign actions config — stored as JSONB in campaigns.actions
// Each action can be a plain number (legacy) or a config object with a
// required `points` field plus optional behaviour flags.
// DB shape example:
//   { "trade": { "label": "Trade CORE daily", "points": 8, "per_day": true } }
export interface ActionConfig {
  points: number
  label?: string
  per_day?: boolean
  one_time?: boolean
  per_referred_trade?: boolean
  per_referral?: boolean
}
export type ActionsConfig = Partial<Record<ActionType, number | ActionConfig>>

/** Extract the points value from an ActionsConfig entry regardless of shape */
export function getActionPoints(
  config: number | ActionConfig | undefined,
  fallback: number
): number {
  if (config === undefined || config === null) return fallback
  if (typeof config === 'number') return config
  return config.points ?? fallback
}

export interface Campaign {
  id: string
  campaign_type: CampaignType
  name: string
  status: CampaignStatus
  closed: boolean           // true when operator calls closeCampaign() on-chain; blocks new credits
  closed_at: string | null  // ISO timestamp set when closed; starts the 7-day withdrawal cooldown
  start_date: string | null
  end_date: string | null

  // Token pool fields
  token_contract: string | null
  token_decimals: number              // default 18; set to 6 for USDC, 8 for WBTC etc.
  token_allocation_usd: number | null
  buyer_reward_pct: number | null
  referral_reward_pct: number | null
  platform_fee_pct: number            // default 2
  claim_duration_mins: number | null
  pool_remaining_usd: number | null

  // Points campaign fields
  pool_usd: number | null
  token_symbol: string | null
  epoch_duration_days: number | null
  epoch_count: number | null
  actions: ActionsConfig | null
  min_score: number                   // default 0
  sponsorship_fee: number | null

  // On-chain settlement (Ticket 5 / Ticket 6)
  // Set by operator after deploying MintwareDistributor via scripts/deploy.ts
  contract_address: string | null   // deployed MintwareDistributor address
  chain: string | null              // 'base' | 'base_sepolia' | 'core_dao' | 'bnb'

  // New columns from migration 000004
  daily_wallet_cap_usd: number | null
  daily_pool_cap_usd: number | null
  use_score_multiplier: boolean

  created_at: string
  updated_at: string
}

export interface Participant {
  id: string
  campaign_id: string
  wallet: string
  joined_at: string
  attribution_score: number
  sharing_score: number
  total_points: number
  total_earned_usd: number
  last_active_at: string | null
  created_at: string
  updated_at: string
}

export interface ActivityRow {
  id: string
  campaign_id: string
  wallet: string
  action_type: ActionType     // DB column: action_type
  points_earned: number | null  // DB column: points_earned; null for token_pool campaigns
  reward_usd: number | null   // null for points campaigns
  tx_hash: string
  referred_by: string | null  // DB column: referred_by
  recorded_at: string         // DB column: recorded_at (was credited_at)
}

// ---------------------------------------------------------------------------
// Inbound swap event — posted by Molten callback (or our stub endpoint)
// ---------------------------------------------------------------------------
export interface SwapEvent {
  tx_hash: string       // on-chain transaction hash — primary dedup key
  wallet: string        // checksummed wallet address (lowercased before use)
  campaign_id: string   // which campaign this swap is attributed to
  token_in: string      // token address being sold
  token_out: string     // token address being bought
  amount_usd: number    // USD value of the swap at execution time
  timestamp: string     // ISO 8601 — swap execution time from chain
}

// ---------------------------------------------------------------------------
// Attribution result — returned by processSwapEvent
// ---------------------------------------------------------------------------
export type SkipReason =
  | 'tx_already_credited'
  | 'campaign_not_found'
  | 'campaign_not_live'
  | 'campaign_ended'
  | 'wallet_not_participant'
  | 'action_before_join'
  | 'score_below_minimum'
  | 'already_traded_today'
  | 'pool_insufficient'
  | 'daily_wallet_cap_reached'
  | 'daily_pool_cap_reached'
  | 'db_error'
  | 'tx_failed'
  | 'wallet_mismatch'
  | 'fee_not_paid'
  | 'router_mismatch'

export interface AttributionResult {
  credited: boolean
  skip_reason?: SkipReason
  campaign_type?: CampaignType
  // Token pool outcomes
  buyer_reward_usd?: number
  referral_reward_usd?: number
  platform_fee_usd?: number
  // Points outcomes
  trade_points?: number
  referral_trade_points?: number
  referrer?: string | null
}

// ---------------------------------------------------------------------------
// Score multiplier — Points campaigns only
// Source: campaign logic model §3
// Attribution percentile and sharing percentile each produce a multiplier.
// Combined multiplier is multiplicative. Max = 1.5 × 1.3 = 1.95×
// ---------------------------------------------------------------------------
export interface ScoreMultipliers {
  attribution: number   // 1.0 | 1.25 | 1.5
  sharing: number       // 1.0 | 1.15 | 1.3
  combined: number      // attribution × sharing
}

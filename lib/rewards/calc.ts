// Campaign reward data is sourced from the Attribution Worker's /campaign endpoint.
// The legacy second Worker (mintware-campaigns.ceo-1f9.workers.dev) is dead and unused.

import { API } from '@/lib/web2/api'

export interface CampaignReward {
  isActive: boolean
  buyerRewardPct: number
  referrerRewardPct: number
  campaignName?: string
  rewardToken?: string
}

export async function getCampaignRewards(campaignId: string): Promise<CampaignReward | null> {
  try {
    const res = await fetch(`${API}/campaign?id=${encodeURIComponent(campaignId)}`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      isActive: data.status === 'active',
      buyerRewardPct: data.buyer_reward_pct ?? 0,
      referrerRewardPct: data.referrer_reward_pct ?? 0,
      campaignName: data.name ?? undefined,
      rewardToken: data.reward_token ?? undefined,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Maximum single-trade USD value accepted for reward calculation.
// Mirrors the cap in the swap-event route payload validator — belt-and-suspenders.
// Exported so Solana swap path and tests can share the same ceiling.
export const MAX_SINGLE_TRADE_USD = 10_000

// Clamp a raw trade amount to the global ceiling.
export function capTradeAmount(amountUsd: number): number {
  return Math.min(amountUsd, MAX_SINGLE_TRADE_USD)
}

// ---------------------------------------------------------------------------
// Per-leg reward calculators
// ---------------------------------------------------------------------------

export function calcBuyerReward(
  tradeUSD: number,
  buyerRewardPct: number
): number {
  return (tradeUSD * buyerRewardPct) / 100
}

export function calcReferrerReward(
  tradeUSD: number,
  referrerRewardPct: number
): number {
  return (tradeUSD * referrerRewardPct) / 100
}

// Platform fee is ONLY taken on successful referrals — no referrer, no Mintware cut.
// Fee comes out of the pool at the percentage set at campaign creation, not added on top.
export function calcPlatformFee(
  tradeUSD: number,
  platformFeePct: number,
  hasReferrer: boolean,
): number {
  return hasReferrer ? (tradeUSD * platformFeePct) / 100 : 0
}

// ---------------------------------------------------------------------------
// calcTokenPoolBreakdown — compound reward breakdown for a single trade.
//
// Returns all three legs + the total deduction from the pool.
// Chain-agnostic: EVM and Solana swap paths both use this same math.
//
// @param amountUsd      — pre-clamped trade value (call capTradeAmount first)
// @param buyerPct       — campaign.buyer_reward_pct
// @param referralPct    — campaign.referral_reward_pct
// @param platformPct    — campaign.platform_fee_pct
// @param hasReferrer    — whether an active referral record exists
// ---------------------------------------------------------------------------
export interface TokenPoolBreakdown {
  buyerRewardUsd:    number
  referralRewardUsd: number
  platformFeeUsd:    number
  totalDeduction:    number
}

export function calcTokenPoolBreakdown(
  amountUsd:    number,
  buyerPct:     number,
  referralPct:  number,
  platformPct:  number,
  hasReferrer:  boolean,
): TokenPoolBreakdown {
  const buyerRewardUsd    = calcBuyerReward(amountUsd, buyerPct)
  const referralRewardUsd = hasReferrer ? calcReferrerReward(amountUsd, referralPct) : 0
  const platformFeeUsd    = calcPlatformFee(amountUsd, platformPct, hasReferrer)
  const totalDeduction    = buyerRewardUsd + referralRewardUsd + platformFeeUsd
  return { buyerRewardUsd, referralRewardUsd, platformFeeUsd, totalDeduction }
}

// ---------------------------------------------------------------------------
// applyPointsMultiplier — apply a combined score multiplier to a base point value.
// Round to nearest integer (points are always whole numbers in the ledger).
export function applyPointsMultiplier(basePoints: number, multiplierCombined: number): number {
  return Math.round(basePoints * multiplierCombined)
}

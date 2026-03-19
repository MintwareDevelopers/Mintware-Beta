// Campaign reward data is sourced from the Attribution Worker's /campaign endpoint.
// The legacy second Worker (mintware-campaigns.ceo-1f9.workers.dev) is dead and unused.

import { API } from '@/lib/api'

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

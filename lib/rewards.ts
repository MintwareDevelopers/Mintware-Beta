export interface CampaignReward {
  buyerRewardPct: number
  referrerRewardPct: number
  poolBalance: number
  rewardToken: string
  campaignName: string
  isActive: boolean
}

const CAMPAIGN_WORKER_URL =
  process.env.NEXT_PUBLIC_CAMPAIGN_WORKER_URL ||
  'https://mintware-campaigns.ceo-1f9.workers.dev'

const REWARDS_MODE = process.env.NEXT_PUBLIC_REWARDS_MODE || 'stub'

export async function getCampaignRewards(
  campaignId: string
): Promise<CampaignReward | null> {
  if (!campaignId) return null

  if (REWARDS_MODE === 'stub') {
    try {
      const res = await fetch(
        `${CAMPAIGN_WORKER_URL}/campaign/${campaignId}`,
        { cache: 'no-store' }
      )
      if (!res.ok) return null
      const data = await res.json()
      return {
        buyerRewardPct: data.buyerRewardPct ?? 3,
        referrerRewardPct: data.referrerRewardPct ?? 5,
        poolBalance: data.poolBalance ?? 0,
        rewardToken: data.rewardToken ?? 'USDC',
        campaignName: data.campaignName ?? '',
        isActive: data.isActive ?? false,
      }
    } catch {
      return null
    }
  }

  // REWARDS_MODE === 'contract' — implement when reward pool contract deploys
  // TODO: call deployed reward pool contract
  return null
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

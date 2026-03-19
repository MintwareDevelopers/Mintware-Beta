// getCampaignRewards — removed. Reward data is now sourced directly from
// Supabase (campaigns table) via our own API routes. The legacy stub that
// called mintware-campaigns.ceo-1f9.workers.dev is no longer used.

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

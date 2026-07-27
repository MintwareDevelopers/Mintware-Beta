'use client'

import { calcBuyerReward, calcReferrerReward } from '@/lib/rewards/calc'
import type { CampaignReward } from '@/lib/rewards/calc'

interface RewardPreviewProps {
  campaign: CampaignReward | null
  sellAmountUSD: number | null
  feeBps: number
  feeTokenSymbol: string
  feeAmountUSD: number | null
  isLoading: boolean
}

// Attribution score estimate: ~1pt per $10 traded
function estimateScoreGain(tradeUSD: number | null): number {
  if (!tradeUSD) return 0
  return Math.round(tradeUSD / 10)
}

export function RewardPreview({
  campaign,
  sellAmountUSD,
  feeBps,
  feeTokenSymbol,
  feeAmountUSD,
  isLoading,
}: RewardPreviewProps) {
  if (!campaign || !campaign.isActive) return null
  if (!sellAmountUSD && !isLoading) return null

  const buyerReward = sellAmountUSD ? calcBuyerReward(sellAmountUSD, campaign.buyerRewardPct) : null
  const referrerReward = sellAmountUSD ? calcReferrerReward(sellAmountUSD, campaign.referrerRewardPct) : null
  const scoreGain = estimateScoreGain(sellAmountUSD)
  const feeDisplay = feeAmountUSD !== null ? `$${feeAmountUSD.toFixed(2)}` : null

  const Shimmer = () => (
    <span className="inline-block w-[60px] h-[13px] bg-[linear-gradient(90deg,#e2e8f0_25%,#f1f5f9_50%,#e2e8f0_75%)] bg-[length:200%_100%] animate-[shimmer_1.4s_infinite]" />
  )

  return (
    <div className="border border-atx-ink/25 bg-atx-bone px-[14px] py-[12px] my-[8px] font-atx-display text-[13px]">
      <div className="flex items-center justify-between py-[3px]">
        <span className="text-atx-ink/55">Buyer reward ({campaign.buyerRewardPct}%)</span>
        <span className="font-atx-mono text-[13px] font-semibold text-atx-mesquite">
          {isLoading ? <Shimmer /> : buyerReward !== null ? `+$${buyerReward.toFixed(2)}` : '—'}
        </span>
      </div>

      <div className="flex items-center justify-between py-[3px] border-t border-atx-ink/10 mt-[3px] pt-[6px]">
        <span className="text-atx-ink/55">Referrer earns ({campaign.referrerRewardPct}%)</span>
        <span className="font-atx-mono text-[13px] font-semibold text-atx-mesquite">
          {isLoading ? <Shimmer /> : referrerReward !== null ? `+$${referrerReward.toFixed(2)}` : '—'}
        </span>
      </div>

      <div className="flex items-center justify-between py-[3px] border-t border-atx-ink/10 mt-[3px] pt-[6px]">
        <span className="text-atx-ink/55">Attribution score</span>
        <span className="font-atx-mono text-[13px] font-semibold text-atx-blue">
          {isLoading ? <Shimmer /> : scoreGain > 0 ? `+${scoreGain} pts` : '—'}
        </span>
      </div>

      <div className="flex items-center justify-between py-[3px] border-t border-atx-ink/10 mt-[3px] pt-[6px]">
        <span className="text-atx-ink/55">MW fee ({(feeBps / 100).toFixed(1)}%) in {feeTokenSymbol}</span>
        <span className="font-atx-mono text-[13px] font-semibold text-atx-ink/55">
          {isLoading ? <Shimmer /> : feeDisplay ?? '—'}
        </span>
      </div>
    </div>
  )
}

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

  return (
    <div className="rounded-[10px] border border-[rgba(22,163,74,0.18)] bg-[rgba(22,163,74,0.04)] px-[14px] py-[12px] my-[8px] font-sans text-[13px]">
      <div className="flex items-center justify-between py-[3px] text-[#3A3C52]">
        <span className="text-mw-ink-4">Buyer reward ({campaign.buyerRewardPct}%)</span>
        <span className="font-mono text-[13px] font-semibold text-mw-green">
          {isLoading ? (
            <span className="inline-block w-[60px] h-[13px] bg-[linear-gradient(90deg,#e2e8f0_25%,#f1f5f9_50%,#e2e8f0_75%)] bg-[length:200%_100%] animate-[shimmer_1.4s_infinite] rounded-[4px]" />
          ) : buyerReward !== null ? `+$${buyerReward.toFixed(2)}` : '—'}
        </span>
      </div>

      <div className="flex items-center justify-between py-[3px] text-[#3A3C52] border-t border-[rgba(26,26,46,0.05)] mt-[3px] pt-[6px]">
        <span className="text-mw-ink-4">Referrer earns ({campaign.referrerRewardPct}%)</span>
        <span className="font-mono text-[13px] font-semibold text-mw-green">
          {isLoading ? (
            <span className="inline-block w-[60px] h-[13px] bg-[linear-gradient(90deg,#e2e8f0_25%,#f1f5f9_50%,#e2e8f0_75%)] bg-[length:200%_100%] animate-[shimmer_1.4s_infinite] rounded-[4px]" />
          ) : referrerReward !== null ? `+$${referrerReward.toFixed(2)}` : '—'}
        </span>
      </div>

      <div className="flex items-center justify-between py-[3px] text-[#3A3C52] border-t border-[rgba(26,26,46,0.05)] mt-[3px] pt-[6px]">
        <span className="text-mw-ink-4">Attribution score</span>
        <span className="font-mono text-[13px] font-semibold text-mw-green">
          {isLoading ? (
            <span className="inline-block w-[60px] h-[13px] bg-[linear-gradient(90deg,#e2e8f0_25%,#f1f5f9_50%,#e2e8f0_75%)] bg-[length:200%_100%] animate-[shimmer_1.4s_infinite] rounded-[4px]" />
          ) : scoreGain > 0 ? `+${scoreGain} pts` : '—'}
        </span>
      </div>

      <div className="flex items-center justify-between py-[3px] text-[#3A3C52] border-t border-[rgba(26,26,46,0.05)] mt-[3px] pt-[6px]">
        <span className="text-mw-ink-4">MW fee ({(feeBps / 100).toFixed(1)}%) in {feeTokenSymbol}</span>
        <span className="font-mono text-[13px] font-semibold text-mw-ink-4">
          {isLoading ? (
            <span className="inline-block w-[60px] h-[13px] bg-[linear-gradient(90deg,#e2e8f0_25%,#f1f5f9_50%,#e2e8f0_75%)] bg-[length:200%_100%] animate-[shimmer_1.4s_infinite] rounded-[4px]" />
          ) : feeDisplay ?? '—'}
        </span>
      </div>
    </div>
  )
}

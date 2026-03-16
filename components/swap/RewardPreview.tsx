'use client'

import { calcBuyerReward, calcReferrerReward } from '@/lib/rewards'
import type { CampaignReward } from '@/lib/rewards'

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
    <>
      <style>{`
        .mw-reward-preview {
          border-radius: 10px;
          border: 1px solid rgba(22,163,74,0.18);
          background: rgba(22,163,74,0.04);
          padding: 12px 14px;
          margin: 8px 0;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px;
        }
        .mw-reward-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 3px 0;
          color: #3A3C52;
        }
        .mw-reward-row + .mw-reward-row { border-top: 1px solid rgba(26,26,46,0.05); margin-top: 3px; padding-top: 6px; }
        .mw-reward-label { color: #8A8C9E; }
        .mw-reward-value {
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 13px; font-weight: 600;
          color: #16a34a;
        }
        .mw-reward-value.neutral { color: #8A8C9E; }
        .mw-reward-skeleton {
          display: inline-block;
          width: 60px; height: 13px;
          background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
          background-size: 200% 100%;
          animation: mw-shimmer 1.4s infinite;
          border-radius: 4px;
        }
        @keyframes mw-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>

      <div className="mw-reward-preview">
        <div className="mw-reward-row">
          <span className="mw-reward-label">Buyer reward ({campaign.buyerRewardPct}%)</span>
          <span className="mw-reward-value">
            {isLoading ? <span className="mw-reward-skeleton" /> : buyerReward !== null ? `+$${buyerReward.toFixed(2)}` : '—'}
          </span>
        </div>

        <div className="mw-reward-row">
          <span className="mw-reward-label">Referrer earns ({campaign.referrerRewardPct}%)</span>
          <span className="mw-reward-value">
            {isLoading ? <span className="mw-reward-skeleton" /> : referrerReward !== null ? `+$${referrerReward.toFixed(2)}` : '—'}
          </span>
        </div>

        <div className="mw-reward-row">
          <span className="mw-reward-label">Attribution score</span>
          <span className="mw-reward-value">
            {isLoading ? <span className="mw-reward-skeleton" /> : scoreGain > 0 ? `+${scoreGain} pts` : '—'}
          </span>
        </div>

        <div className="mw-reward-row">
          <span className="mw-reward-label">MW fee ({(feeBps / 100).toFixed(1)}%) in {feeTokenSymbol}</span>
          <span className="mw-reward-value neutral">
            {isLoading ? <span className="mw-reward-skeleton" /> : feeDisplay ?? '—'}
          </span>
        </div>
      </div>
    </>
  )
}

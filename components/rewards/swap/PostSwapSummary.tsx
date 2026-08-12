'use client'

import { shortAddr } from '@/lib/web2/api'
import { calcBuyerReward, calcReferrerReward } from '@/lib/rewards/calc'
import type { CampaignReward } from '@/lib/rewards/calc'
import type { Token } from '@/config/tokens'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

interface PostSwapSummaryProps {
  txHash: string
  buyAmount: string
  buyToken: Token | null
  sellAmountUSD: number | null
  campaign: CampaignReward | null
  referrer: string | null
  estimatedScoreGain: number
  currentScore: number
  onDismiss: () => void
}

export function PostSwapSummary({
  txHash,
  buyAmount,
  buyToken,
  sellAmountUSD,
  campaign,
  referrer,
  estimatedScoreGain,
  currentScore,
  onDismiss,
}: PostSwapSummaryProps) {
  const { address } = useMintwareIdentity()

  const buyerReward = campaign && sellAmountUSD
    ? calcBuyerReward(sellAmountUSD, campaign.buyerRewardPct)
    : null

  const referrerReward = campaign && sellAmountUSD
    ? calcReferrerReward(sellAmountUSD, campaign.referrerRewardPct)
    : null

  const newScore = currentScore + estimatedScoreGain

  const referralUrl = address
    ? `${window.location.origin}/app/swap?ref=${address}`
    : null

  function copyReferralLink() {
    if (referralUrl) navigator.clipboard.writeText(referralUrl)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] bg-atx-ink/40 backdrop-blur-[6px] flex items-center justify-center p-[16px]"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss() }}
    >
      <div className="bg-atx-panel border border-atx-ink w-full max-w-[380px] shadow-[4px_4px_0_0_rgba(17,17,17,0.12)] overflow-hidden">
        <div className="bg-atx-bone border-b border-atx-ink px-[24px] pt-[28px] pb-[20px] text-center">
          <div className="flex justify-center mb-[8px]">
            <svg viewBox="0 0 100 100" className="w-5 h-5 text-atx-coral" aria-hidden="true"><path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"/></svg>
          </div>
          <div className="font-atx-display text-[20px] font-bold text-atx-ink">Swap confirmed</div>
          {buyAmount && buyToken && (
            <div className="font-atx-mono text-[14px] text-atx-blue font-semibold mt-[4px]">
              {parseFloat(buyAmount).toFixed(6)} {buyToken.symbol} received
            </div>
          )}
        </div>

        <div className="px-[24px] py-[20px]">
          {buyerReward !== null && campaign && (
            <div className="flex items-start gap-[12px] py-[10px] border-b border-atx-ink/10">
              <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block mt-[5px] shrink-0" />
              <div className="flex-1">
                <div className="font-atx-display text-[13px] font-semibold text-atx-ink">
                  <span className="font-atx-mono text-[13px] font-semibold text-atx-mesquite">${buyerReward.toFixed(2)} {campaign.rewardToken}</span> buyer reward queued
                </div>
                <div className="font-atx-display text-[12px] text-atx-ink/55 mt-[1px]">Settles when reward pool contract deploys</div>
              </div>
            </div>
          )}

          {estimatedScoreGain > 0 && (
            <div className="flex items-start gap-[12px] py-[10px] border-b border-atx-ink/10">
              <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block mt-[5px] shrink-0" />
              <div className="flex-1">
                <div className="font-atx-display text-[13px] font-semibold text-atx-ink">
                  Attribution score <span className="font-atx-mono text-[13px] font-semibold text-atx-mesquite">+{estimatedScoreGain} pts</span>
                </div>
                <div className="font-atx-display text-[12px] text-atx-ink/55 mt-[1px]">New score: {newScore}</div>
              </div>
            </div>
          )}

          {referrerReward !== null && referrer && campaign && (
            <div className="flex items-start gap-[12px] py-[10px]">
              <span className="text-[16px] mt-[1px] shrink-0 text-atx-ink/45">↗</span>
              <div className="flex-1">
                <div className="font-atx-display text-[13px] font-semibold text-atx-ink/60">
                  <strong className="font-atx-mono text-[12px]">
                    {shortAddr(referrer)}
                  </strong>{' '}
                  earned <span className="font-atx-mono text-[13px] font-semibold text-atx-mesquite">${referrerReward.toFixed(2)}</span> from this swap
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-[24px] pb-[24px] flex flex-col gap-[8px]">
          {referralUrl && (
            <button
              className="w-full py-[10px] bg-transparent border border-atx-ink text-atx-ink font-atx-mono text-[13px] font-semibold uppercase tracking-[0.05em] cursor-pointer transition-all duration-150 hover:bg-atx-bone"
              onClick={copyReferralLink}
            >
              Copy your referral link
            </button>
          )}
          <button
            className="w-full py-[10px] bg-atx-blue border border-atx-ink text-white font-atx-mono text-[13px] font-semibold uppercase tracking-[0.05em] cursor-pointer transition-all duration-150 hover:opacity-90"
            onClick={onDismiss}
          >
            Done
          </button>
          <div className="font-atx-mono text-[10px] text-atx-ink/45 text-center mt-[6px] break-all">
            tx: {txHash.slice(0, 20)}…{txHash.slice(-8)}
          </div>
        </div>
      </div>
    </div>
  )
}

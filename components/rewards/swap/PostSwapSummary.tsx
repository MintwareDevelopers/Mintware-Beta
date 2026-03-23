'use client'

import { useAccount } from 'wagmi'
import { shortAddr } from '@/lib/web2/api'
import { calcBuyerReward, calcReferrerReward } from '@/lib/rewards/calc'
import type { CampaignReward } from '@/lib/rewards/calc'
import type { Token } from '@/config/tokens'

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
  const { address } = useAccount()

  const buyerReward = campaign && sellAmountUSD
    ? calcBuyerReward(sellAmountUSD, campaign.buyerRewardPct)
    : null

  const referrerReward = campaign && sellAmountUSD
    ? calcReferrerReward(sellAmountUSD, campaign.referrerRewardPct)
    : null

  const newScore = currentScore + estimatedScoreGain

  const referralUrl = address
    ? `${window.location.origin}/swap?ref=${address}`
    : null

  function copyReferralLink() {
    if (referralUrl) navigator.clipboard.writeText(referralUrl)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] bg-[rgba(26,26,46,0.4)] backdrop-blur-[6px] flex items-center justify-center p-[16px]"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss() }}
    >
      <div className="bg-white rounded-lg w-full max-w-[380px] shadow-[0_20px_60px_rgba(26,26,46,0.18)] overflow-hidden">
        <div className="bg-[linear-gradient(135deg,rgba(0,82,255,0.06),rgba(22,163,74,0.06))] px-[24px] pt-[28px] pb-[20px] text-center">
          <div className="text-[40px] mb-[8px]">✓</div>
          <div className="font-serif text-[20px] font-bold text-mw-ink">Swap confirmed</div>
          {buyAmount && buyToken && (
            <div className="font-mono text-[14px] text-mw-brand font-semibold mt-[4px]">
              {parseFloat(buyAmount).toFixed(6)} {buyToken.symbol} received
            </div>
          )}
        </div>

        <div className="px-[24px] py-[20px]">
          {buyerReward !== null && campaign && (
            <div className="flex items-start gap-[12px] py-[10px] border-b border-[rgba(26,26,46,0.06)]">
              <span className="text-[16px] mt-[1px] shrink-0">✓</span>
              <div className="flex-1">
                <div className="font-sans text-[13px] font-semibold text-mw-ink">
                  <span className="font-mono text-[13px] font-semibold text-mw-green">${buyerReward.toFixed(2)} {campaign.rewardToken}</span> buyer reward queued
                </div>
                <div className="font-sans text-[12px] text-mw-ink-4 mt-[1px]">Settles when reward pool contract deploys</div>
              </div>
            </div>
          )}

          {estimatedScoreGain > 0 && (
            <div className="flex items-start gap-[12px] py-[10px] border-b border-[rgba(26,26,46,0.06)]">
              <span className="text-[16px] mt-[1px] shrink-0">✓</span>
              <div className="flex-1">
                <div className="font-sans text-[13px] font-semibold text-mw-ink">
                  Attribution score <span className="font-mono text-[13px] font-semibold text-mw-green">+{estimatedScoreGain} pts</span>
                </div>
                <div className="font-sans text-[12px] text-mw-ink-4 mt-[1px]">New score: {newScore}</div>
              </div>
            </div>
          )}

          {referrerReward !== null && referrer && campaign && (
            <div className="flex items-start gap-[12px] py-[10px]">
              <span className="text-[16px] mt-[1px] shrink-0 text-mw-ink-4">↗</span>
              <div className="flex-1">
                <div className="font-sans text-[13px] font-semibold text-mw-ink-4">
                  <strong className="font-mono text-[12px]">
                    {shortAddr(referrer)}
                  </strong>{' '}
                  earned <span className="font-mono text-[13px] font-semibold text-mw-green">${referrerReward.toFixed(2)}</span> from this swap
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-[24px] pb-[24px] flex flex-col gap-[8px]">
          {referralUrl && (
            <button
              className="w-full py-[10px] rounded-[10px] bg-[rgba(0,82,255,0.08)] border border-[rgba(0,82,255,0.18)] text-mw-brand font-sans text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:bg-[rgba(0,82,255,0.14)]"
              onClick={copyReferralLink}
            >
              📎 Copy your referral link
            </button>
          )}
          <button
            className="w-full py-[10px] rounded-[10px] bg-mw-ink border-0 text-white font-sans text-[13px] font-semibold cursor-pointer transition-colors duration-150 hover:bg-[#2d2d48]"
            onClick={onDismiss}
          >
            Done
          </button>
          <div className="font-mono text-[10px] text-mw-ink-4 text-center mt-[6px] break-all">
            tx: {txHash.slice(0, 20)}…{txHash.slice(-8)}
          </div>
        </div>
      </div>
    </div>
  )
}

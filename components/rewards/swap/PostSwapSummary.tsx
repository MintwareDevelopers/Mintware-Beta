'use client'

import type { Token } from '@/config/tokens'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

interface PostSwapSummaryProps {
  txHash: string
  buyAmount: string
  buyToken: Token | null
  sellAmountUSD: number | null
  estimatedScoreGain: number
  currentScore: number
  onDismiss: () => void
}

export function PostSwapSummary({
  txHash,
  buyAmount,
  buyToken,
  estimatedScoreGain,
  currentScore,
  onDismiss,
}: PostSwapSummaryProps) {
  const { address } = useMintwareIdentity()

  const newScore = currentScore + estimatedScoreGain

  const referralUrl = address
    ? `${window.location.origin}/app/swap?ref=${address}`
    : null

  function copyReferralLink() {
    if (referralUrl) navigator.clipboard.writeText(referralUrl)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] bg-ink/40 backdrop-blur-[6px] flex items-center justify-center p-[16px]"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss() }}
    >
      <div className="bg-white border border-hair rounded-[var(--radius-panel)] w-full max-w-[380px] shadow-lift overflow-hidden">
        <div className="bg-ground-cool border-b border-hair-soft px-[24px] pt-[28px] pb-[20px] text-center">
          <div className="flex justify-center mb-[10px]">
            <span className="w-10 h-10 rounded-full grid place-items-center text-white text-[18px]" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))', boxShadow: '0 4px 14px rgba(108,108,240,0.35)' }}>✓</span>
          </div>
          <div className="font-atx-display text-[20px] font-medium text-ink tracking-[-0.01em]">Swap confirmed</div>
          {buyAmount && buyToken && (
            <div className="font-mono text-[14px] text-peri-deep font-semibold mt-[4px]">
              {parseFloat(buyAmount).toFixed(6)} {buyToken.symbol} received
            </div>
          )}
        </div>

        <div className="px-[24px] py-[20px]">
          {estimatedScoreGain > 0 && (
            <div className="flex items-start gap-[12px] py-[10px] border-b border-hair-soft">
              <span className="w-[8px] h-[8px] rounded-full bg-peri inline-block mt-[6px] shrink-0" />
              <div className="flex-1">
                <div className="font-atx-display text-[13px] font-semibold text-ink">
                  Attribution score <span className="font-mono text-[13px] font-semibold text-coral2-deep">+{estimatedScoreGain} pts</span>
                </div>
                <div className="text-[12px] text-ink-soft mt-[1px]">New score: {newScore}</div>
              </div>
            </div>
          )}

        </div>

        <div className="px-[24px] pb-[24px] flex flex-col gap-[8px]">
          {referralUrl && (
            <button
              className="w-full py-[10px] rounded-full border border-hair bg-white text-ink-mid text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:text-ink hover:border-[rgba(108,108,240,0.4)]"
              onClick={copyReferralLink}
            >
              Copy your referral link
            </button>
          )}
          <button
            className="w-full py-[10px] rounded-full bg-peri text-white text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:bg-peri-deep"
            onClick={onDismiss}
          >
            Done
          </button>
          <div className="font-mono text-[10px] text-ink-soft text-center mt-[6px] break-all">
            tx: {txHash.slice(0, 20)}…{txHash.slice(-8)}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import type { Token } from '@/config/tokens'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

interface PostSwapSummaryProps {
  txHash: string
  buyAmount: string
  buyToken: Token | null
  sellAmountUSD: number | null
  onDismiss: () => void
}

export function PostSwapSummary({
  txHash,
  buyAmount,
  buyToken,
  onDismiss,
}: PostSwapSummaryProps) {
  const { address } = useMintwareIdentity()

  const referralUrl = address
    ? `${window.location.origin}/app/swap?ref=${address}`
    : null

  function copyReferralLink() {
    if (referralUrl) navigator.clipboard.writeText(referralUrl)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] bg-[rgba(21,21,29,.32)] backdrop-blur-[6px] flex items-center justify-center p-[16px] font-geist"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss() }}
    >
      <div className="mw-raise-lg rounded-[26px] w-full max-w-[400px] overflow-hidden">
        <div className="relative overflow-hidden px-[24px] pt-[30px] pb-[22px] text-center">
          <div aria-hidden="true" className="absolute -right-20 -top-24 w-64 h-64 rounded-full opacity-30 blur-[50px]" style={{ background: 'var(--mw-sheen)' }} />
          <div className="relative flex justify-center mb-[12px]">
            <span className="w-12 h-12 rounded-full grid place-items-center text-white" style={{ background: '#0F7A43', boxShadow: '0 0 0 6px rgba(15,122,67,.12)' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
            </span>
          </div>
          <div className="relative text-[20px] font-semibold text-ink tracking-[-0.02em]">Swap confirmed</div>
          {buyAmount && buyToken && (
            <div className="relative font-geist-mono text-[15px] mt-[6px]" style={{ color: 'var(--mw-gain)' }}>
              {parseFloat(buyAmount).toFixed(6)} {buyToken.symbol} received
            </div>
          )}
        </div>

        <div className="px-[24px] pb-[24px] flex flex-col gap-[8px]">
          {referralUrl && (
            <button
              className="mw-btn-quiet w-full !rounded-[14px] text-[14px]"
              onClick={copyReferralLink}
            >
              Copy your referral link
            </button>
          )}
          <button
            className="mw-btn w-full !min-h-[48px] !rounded-[14px] text-[15px]"
            onClick={onDismiss}
          >
            Done
          </button>
          <div className="font-geist-mono text-[12px] text-ink-soft text-center mt-[6px] break-all">
            tx: {txHash.slice(0, 20)}…{txHash.slice(-8)}
          </div>
        </div>
      </div>
    </div>
  )
}

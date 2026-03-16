'use client'

import { useAccount } from 'wagmi'
import { shortAddr } from '@/lib/api'
import { calcBuyerReward, calcReferrerReward } from '@/lib/rewards'
import type { CampaignReward } from '@/lib/rewards'
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
    <>
      <style>{`
        .mw-post-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(26,26,46,0.4);
          backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .mw-post-modal {
          background: #fff;
          border-radius: 16px;
          width: 100%; max-width: 380px;
          box-shadow: 0 20px 60px rgba(26,26,46,0.18);
          overflow: hidden;
        }
        .mw-post-header {
          background: linear-gradient(135deg, rgba(0,82,255,0.06), rgba(22,163,74,0.06));
          padding: 28px 24px 20px;
          text-align: center;
        }
        .mw-post-checkmark { font-size: 40px; margin-bottom: 8px; }
        .mw-post-title { font-family: Georgia, serif; font-size: 20px; font-weight: 700; color: #1A1A2E; }
        .mw-post-subtitle {
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 14px; color: #0052FF; font-weight: 600; margin-top: 4px;
        }
        .mw-post-body { padding: 20px 24px; }
        .mw-post-row {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid rgba(26,26,46,0.06);
        }
        .mw-post-row:last-of-type { border-bottom: none; }
        .mw-post-row-icon { font-size: 16px; margin-top: 1px; flex-shrink: 0; }
        .mw-post-row-content { flex: 1; }
        .mw-post-row-label { font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 600; color: #1A1A2E; }
        .mw-post-row-sub { font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif; font-size: 12px; color: #8A8C9E; margin-top: 1px; }
        .mw-post-row-value { font-family: var(--font-mono), 'DM Mono', monospace; font-size: 13px; font-weight: 600; color: #16a34a; }
        .mw-post-footer { padding: 0 24px 24px; display: flex; flex-direction: column; gap: 8px; }
        .mw-post-ref-btn {
          width: 100%;
          padding: 10px;
          border-radius: 10px;
          background: rgba(0,82,255,0.08);
          border: 1px solid rgba(0,82,255,0.18);
          color: #0052FF;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.15s;
        }
        .mw-post-ref-btn:hover { background: rgba(0,82,255,0.14); }
        .mw-post-dismiss {
          width: 100%;
          padding: 10px;
          border-radius: 10px;
          background: #1A1A2E;
          border: none;
          color: #fff;
          font-family: var(--font-jakarta), 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: background 0.15s;
        }
        .mw-post-dismiss:hover { background: #2d2d48; }
        .mw-post-tx {
          font-family: var(--font-mono), 'DM Mono', monospace;
          font-size: 10px; color: #8A8C9E;
          text-align: center; margin-top: 6px;
          word-break: break-all;
        }
      `}</style>

      <div className="mw-post-overlay" onClick={(e) => { if (e.target === e.currentTarget) onDismiss() }}>
        <div className="mw-post-modal">
          <div className="mw-post-header">
            <div className="mw-post-checkmark">✓</div>
            <div className="mw-post-title">Swap confirmed</div>
            {buyAmount && buyToken && (
              <div className="mw-post-subtitle">
                {parseFloat(buyAmount).toFixed(6)} {buyToken.symbol} received
              </div>
            )}
          </div>

          <div className="mw-post-body">
            {buyerReward !== null && campaign && (
              <div className="mw-post-row">
                <span className="mw-post-row-icon">✓</span>
                <div className="mw-post-row-content">
                  <div className="mw-post-row-label">
                    <span className="mw-post-row-value">${buyerReward.toFixed(2)} {campaign.rewardToken}</span> buyer reward queued
                  </div>
                  <div className="mw-post-row-sub">Settles when reward pool contract deploys</div>
                </div>
              </div>
            )}

            {estimatedScoreGain > 0 && (
              <div className="mw-post-row">
                <span className="mw-post-row-icon">✓</span>
                <div className="mw-post-row-content">
                  <div className="mw-post-row-label">
                    Attribution score <span className="mw-post-row-value">+{estimatedScoreGain} pts</span>
                  </div>
                  <div className="mw-post-row-sub">New score: {newScore}</div>
                </div>
              </div>
            )}

            {referrerReward !== null && referrer && campaign && (
              <div className="mw-post-row">
                <span className="mw-post-row-icon" style={{ color: '#8A8C9E' }}>↗</span>
                <div className="mw-post-row-content">
                  <div className="mw-post-row-label" style={{ color: '#8A8C9E' }}>
                    <strong style={{ fontFamily: "var(--font-mono), 'DM Mono', monospace", fontSize: 12 }}>
                      {shortAddr(referrer)}
                    </strong>{' '}
                    earned <span className="mw-post-row-value">${referrerReward.toFixed(2)}</span> from this swap
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mw-post-footer">
            {referralUrl && (
              <button className="mw-post-ref-btn" onClick={copyReferralLink}>
                📎 Copy your referral link
              </button>
            )}
            <button className="mw-post-dismiss" onClick={onDismiss}>
              Done
            </button>
            <div className="mw-post-tx">tx: {txHash.slice(0, 20)}…{txHash.slice(-8)}</div>
          </div>
        </div>
      </div>
    </>
  )
}

'use client'

import { RefCodeInput } from './RefCodeInput'
import { truncateAddress } from '@/lib/referral/utils'
import type { ReferralStats, ReferralRecord } from '@/lib/referral/types'

interface InviteTabProps {
  wallet:          string
  refCode:         string | null
  stats:           ReferralStats | null
  referralRecords: ReferralRecord[]
  isLoading:       boolean
}

export function InviteTab({ wallet, refCode, stats, referralRecords, isLoading }: InviteTabProps) {
  const origin  = typeof window !== 'undefined' ? window.location.origin : 'https://mintware.xyz'
  const refLink = refCode ? `${origin}/ref/${refCode}` : null

  const sharingScore = stats?.sharing_score ?? 0
  const treeSize     = stats?.tree_size     ?? 0
  const qualityPct   = stats ? Math.round(stats.tree_quality * 100) : 0
  const pct          = Math.round((sharingScore / 125) * 100)

  const sortedRecords = [...referralRecords].sort((a, b) =>
    a.status === 'active' ? -1 : b.status === 'active' ? 1 : 0
  )

  function shareOnTwitter() {
    if (!refLink) return
    const text = encodeURIComponent(
      `I just got my on-chain reputation score on @MintwareDev — it's live now.\n\nCheck yours and join my network: ${refLink}`
    )
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'noopener')
  }

  return (
    <>
      <style>{`
        .invite-hero {
          background: linear-gradient(135deg, var(--color-mw-ink) 0%, #2A1A46 100%);
          border-radius: var(--radius-xl);
          padding: 28px 28px 24px;
          margin-bottom: 12px;
          position: relative;
          overflow: hidden;
        }
        .invite-hero::before {
          content: '';
          position: absolute;
          top: -40px; right: -40px;
          width: 200px; height: 200px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(194,83,122,0.25) 0%, transparent 70%);
          pointer-events: none;
        }
        .invite-hero-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--color-mw-pink);
          margin-bottom: 10px;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
        }
        .invite-hero-headline {
          font-size: 22px;
          font-weight: 700;
          color: rgba(255,255,255,0.92);
          line-height: 1.25;
          margin-bottom: 6px;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          letter-spacing: -0.4px;
        }
        .invite-hero-sub {
          font-size: 13px;
          color: rgba(255,255,255,0.55);
          line-height: 1.55;
          margin-bottom: 22px;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          max-width: 320px;
        }
        .invite-score-strip {
          display: flex;
          align-items: center;
          gap: 14px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(194,83,122,0.25);
          border-radius: var(--radius-md);
          padding: 14px 18px;
        }
        .invite-score-big {
          font-size: 36px;
          font-weight: 700;
          color: var(--color-mw-pink);
          font-family: var(--font-mono, 'DM Mono', monospace);
          line-height: 1;
          letter-spacing: -1px;
          flex-shrink: 0;
        }
        .invite-score-big span {
          font-size: 14px;
          color: rgba(194,83,122,0.45);
        }
        .invite-score-right {
          flex: 1;
          min-width: 0;
        }
        .invite-score-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: rgba(255,255,255,0.5);
          margin-bottom: 6px;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
        }
        .invite-score-bar-wrap {
          height: 4px;
          background: rgba(194,83,122,0.15);
          border-radius: 2px;
          overflow: hidden;
        }
        .invite-score-bar-fill {
          height: 100%;
          background: var(--color-mw-pink);
          border-radius: 2px;
          transition: width 0.8s var(--easing-spring);
        }

        .invite-value-row {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .invite-value-pill {
          flex: 1;
          background: var(--color-mw-surface-purple);
          border: 1.5px solid rgba(58,92,232,0.1);
          border-radius: var(--radius-md);
          padding: 12px 14px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .invite-value-icon {
          font-size: 18px;
          line-height: 1;
          margin-top: 1px;
        }
        .invite-value-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-mw-ink);
          margin-bottom: 2px;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
        }
        .invite-value-desc {
          font-size: 11px;
          color: var(--color-mw-ink-4);
          line-height: 1.4;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
        }

        .invite-card {
          background: #fff;
          border: 0.5px solid var(--color-mw-border);
          border-radius: 18px;
          padding: 20px 22px;
          margin-bottom: 12px;
          box-shadow: var(--shadow-card);
        }
        .invite-section-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--color-mw-brand-deep);
          margin-bottom: 14px;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
        }

        .invite-stats-row {
          display: flex;
          gap: 12px;
          margin-bottom: 12px;
        }
        .invite-stat-box {
          flex: 1;
          background: var(--color-mw-surface-purple);
          border: 1.5px solid var(--color-mw-border);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          text-align: center;
        }
        .invite-stat-num {
          font-size: 24px;
          font-weight: 700;
          color: var(--color-mw-ink);
          font-family: var(--font-mono, 'DM Mono', monospace);
          letter-spacing: -0.5px;
          line-height: 1;
          margin-bottom: 4px;
        }
        .invite-stat-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: var(--color-mw-ink-4);
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
        }
        .invite-stat-loading {
          height: 24px;
          width: 36px;
          background: rgba(26,26,46,0.06);
          border-radius: 4px;
          margin: 0 auto 4px;
          animation: invite-pulse 1.4s ease-in-out infinite;
        }
        @keyframes invite-pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.9; }
        }

        .invite-share-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .invite-code-label {
          font-size: 11px;
          color: var(--color-mw-ink-4);
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          margin-bottom: 4px;
        }

        .invite-share-btn {
          width: 100%;
          padding: 12px;
          background: #1DA1F2;
          color: #fff;
          border: none;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          cursor: pointer;
          transition: opacity var(--transition-fast);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          margin-top: 4px;
        }
        .invite-share-btn:active { opacity: 0.8; }

        .invite-wallet-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .invite-wallet-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          background: var(--color-mw-surface-purple);
          border: 1.5px solid var(--color-mw-border);
          border-radius: var(--radius-sm);
        }
        .invite-wallet-addr {
          font-size: 12px;
          font-family: var(--font-mono, 'DM Mono', monospace);
          color: var(--color-mw-ink-2);
        }
        .invite-status-badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.4px;
          padding: 3px 9px;
          border-radius: 100px;
          text-transform: uppercase;
        }
        .invite-status-active {
          background: rgba(42,158,138,0.12);
          color: var(--color-mw-teal);
        }
        .invite-status-pending {
          background: rgba(194,122,0,0.1);
          color: var(--color-mw-amber);
        }
        .invite-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 24px 0 12px;
          color: var(--color-mw-ink-4);
        }
        .invite-empty-icon {
          font-size: 26px;
          opacity: 0.4;
        }
        .invite-empty-text {
          font-size: 13px;
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', sans-serif);
          text-align: center;
          max-width: 220px;
          line-height: 1.55;
        }
      `}</style>

      {/* Hero — value prop */}
      <div className="invite-hero">
        <div className="invite-hero-eyebrow">Sharing score</div>
        <div className="invite-hero-headline">Grow your network,<br />earn more rewards.</div>
        <div className="invite-hero-sub">
          Every wallet you refer that stays active raises your Sharing score — which multiplies your reward allocation.
        </div>
        <div className="invite-score-strip">
          <div className="invite-score-big">
            {isLoading ? '—' : sharingScore}<span> / 125</span>
          </div>
          <div className="invite-score-right">
            <div className="invite-score-label">Sharing score</div>
            <div className="invite-score-bar-wrap">
              <div className="invite-score-bar-fill" style={{ width: pct + '%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Why refer */}
      <div className="invite-value-row">
        <div className="invite-value-pill">
          <div className="invite-value-icon">◉</div>
          <div>
            <div className="invite-value-title">Boost your score</div>
            <div className="invite-value-desc">Active referrals raise your Sharing score up to 125 pts</div>
          </div>
        </div>
        <div className="invite-value-pill">
          <div className="invite-value-icon">⬡</div>
          <div>
            <div className="invite-value-title">Earn rewards</div>
            <div className="invite-value-desc">Score multipliers increase your campaign reward allocation</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="invite-stats-row">
        <div className="invite-stat-box">
          {isLoading
            ? <div className="invite-stat-loading" />
            : <div className="invite-stat-num" style={{ color: 'var(--color-mw-brand-deep)' }}>{treeSize}</div>
          }
          <div className="invite-stat-label">Referred</div>
        </div>
        <div className="invite-stat-box">
          {isLoading
            ? <div className="invite-stat-loading" />
            : <div className="invite-stat-num" style={{ color: 'var(--color-mw-teal)' }}>{qualityPct}%</div>
          }
          <div className="invite-stat-label">Active</div>
        </div>
      </div>

      {/* Share Your Link */}
      <div className="invite-card">
        <div className="invite-section-label">Share Your Link</div>
        <div className="invite-share-section">
          {refCode === null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="invite-stat-loading" style={{ width: '100%', height: 40, borderRadius: 8 }} />
              <div className="invite-stat-loading" style={{ width: '60%', height: 40, borderRadius: 8 }} />
            </div>
          ) : (
            <>
              <div>
                <div className="invite-code-label">Referral link</div>
                <RefCodeInput value={refLink!} buttonLabel="Copy Link" />
              </div>
              <div>
                <div className="invite-code-label">Referral code</div>
                <RefCodeInput value={refCode} buttonLabel="Copy Code" ghost />
              </div>
            </>
          )}
          <button className="invite-share-btn" onClick={shareOnTwitter} disabled={!refCode} style={{ opacity: refCode ? 1 : 0.4 }}>
            <svg width="15" height="13" viewBox="0 0 15 13" fill="none">
              <path d="M14.25 1.5C13.72 1.86 13.14 2.13 12.5 2.3C12.14 1.88 11.66 1.58 11.13 1.45C10.59 1.31 10.03 1.35 9.52 1.56C9.01 1.77 8.58 2.13 8.3 2.6C8.01 3.07 7.87 3.62 7.88 4.17V4.79C6.82 4.82 5.77 4.57 4.83 4.08C3.9 3.59 3.11 2.87 2.54 2C2.54 2 0.29 7 5.29 9.25C4.12 10.03 2.73 10.42 1.29 10.38C6.29 13.25 12.54 10.38 12.54 4.12C12.54 3.97 12.53 3.83 12.51 3.68C13.1 3.09 13.53 2.34 14.25 1.5Z" fill="white"/>
            </svg>
            Share on X
          </button>
        </div>
      </div>

      {/* Referred Wallets */}
      <div className="invite-card">
        <div className="invite-section-label">Referred Wallets</div>
        {isLoading ? (
          <div className="invite-empty">
            <div className="invite-stat-loading" style={{ width: 80, height: 12 }} />
          </div>
        ) : sortedRecords.length === 0 ? (
          <div className="invite-empty">
            <div className="invite-empty-icon">◉</div>
            <div className="invite-empty-text">No referrals yet. Share your link to get started.</div>
          </div>
        ) : (
          <div className="invite-wallet-list">
            {sortedRecords.map(r => (
              <div key={r.id} className="invite-wallet-row">
                <span className="invite-wallet-addr">{truncateAddress(r.referred)}</span>
                <span className={`invite-status-badge ${r.status === 'active' ? 'invite-status-active' : 'invite-status-pending'}`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

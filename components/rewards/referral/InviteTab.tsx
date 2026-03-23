'use client'

import { RefCodeInput } from './RefCodeInput'
import { truncateAddress } from '@/lib/rewards/referral/utils'
import type { ReferralStats, ReferralRecord } from '@/lib/rewards/referral/types'

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
      {/* Hero — value prop */}
      <div
        className="rounded-xl p-[28px_28px_24px] mb-3 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, var(--color-mw-ink) 0%, #2A1A46 100%)' }}
      >
        {/* pseudo ::before glow — rendered as absolute div */}
        <div className="absolute top-[-40px] right-[-40px] w-[200px] h-[200px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(194,83,122,0.25) 0%, transparent 70%)' }}
        />
        <div className="text-[10px] font-bold tracking-[1.4px] uppercase text-mw-pink mb-[10px] font-sans">
          Sharing score
        </div>
        <div className="text-[22px] font-bold text-[rgba(255,255,255,0.92)] leading-[1.25] mb-[6px] font-sans tracking-[-0.4px]">
          Grow your network,<br />earn more rewards.
        </div>
        <div className="text-[13px] text-[rgba(255,255,255,0.55)] leading-[1.55] mb-[22px] font-sans max-w-[320px]">
          Every wallet you refer that stays active raises your Sharing score — which multiplies your reward allocation.
        </div>
        <div className="flex items-center gap-[14px] bg-[rgba(255,255,255,0.06)] border border-[rgba(194,83,122,0.25)] rounded-md p-[14px_18px]">
          <div className="text-[36px] font-bold text-mw-pink font-mono leading-[1] tracking-[-1px] shrink-0">
            {isLoading ? '—' : sharingScore}<span className="text-[14px] text-[rgba(194,83,122,0.45)]"> / 125</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.8px] text-[rgba(255,255,255,0.5)] mb-[6px] font-sans">
              Sharing score
            </div>
            <div className="h-[4px] bg-[rgba(194,83,122,0.15)] rounded-[2px] overflow-hidden">
              <div
                className="h-full bg-mw-pink rounded-[2px] transition-[width] duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ width: pct + '%' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Why refer */}
      <div className="flex gap-2 mb-3">
        <div className="mw-accent-card flex-1 rounded-md p-[12px_14px] flex items-start gap-[10px]">
          <div className="text-[18px] leading-[1] mt-[1px]">◉</div>
          <div>
            <div className="text-[12px] font-bold text-mw-ink mb-[2px] font-sans">Boost your score</div>
            <div className="text-[11px] text-mw-ink-4 leading-[1.4] font-sans">Active referrals raise your Sharing score up to 125 pts</div>
          </div>
        </div>
        <div className="mw-accent-card flex-1 rounded-md p-[12px_14px] flex items-start gap-[10px]">
          <div className="text-[18px] leading-[1] mt-[1px]">⬡</div>
          <div>
            <div className="text-[12px] font-bold text-mw-ink mb-[2px] font-sans">Earn rewards</div>
            <div className="text-[11px] text-mw-ink-4 leading-[1.4] font-sans">Score multipliers increase your campaign reward allocation</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-3 mb-3">
        <div className="mw-accent-card flex-1 rounded-md p-[14px_16px] text-center">
          {isLoading
            ? <div className="h-[24px] w-[36px] bg-[rgba(26,26,46,0.06)] rounded-[4px] mx-auto mb-[4px] animate-pulse" />
            : <div className="text-[24px] font-bold font-mono tracking-[-0.5px] leading-[1] mb-[4px] text-mw-brand-deep">{treeSize}</div>
          }
          <div className="text-[10px] font-semibold tracking-[0.5px] uppercase text-mw-ink-4 font-sans">Referred</div>
        </div>
        <div className="mw-accent-card flex-1 rounded-md p-[14px_16px] text-center">
          {isLoading
            ? <div className="h-[24px] w-[36px] bg-[rgba(26,26,46,0.06)] rounded-[4px] mx-auto mb-[4px] animate-pulse" />
            : <div className="text-[24px] font-bold font-mono tracking-[-0.5px] leading-[1] mb-[4px] text-mw-teal">{qualityPct}%</div>
          }
          <div className="text-[10px] font-semibold tracking-[0.5px] uppercase text-mw-ink-4 font-sans">Active</div>
        </div>
      </div>

      {/* Share Your Link */}
      <div className="mw-accent-card rounded-[18px] p-[20px_22px] mb-3 shadow-card">
        <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-mw-brand-deep mb-[14px] font-sans">
          Share Your Link
        </div>
        <div className="flex flex-col gap-[10px]">
          {refCode === null ? (
            <div className="flex flex-col gap-2">
              <div className="h-[40px] w-full bg-[rgba(26,26,46,0.06)] rounded-[8px] animate-pulse" />
              <div className="h-[40px] w-[60%] bg-[rgba(26,26,46,0.06)] rounded-[8px] animate-pulse" />
            </div>
          ) : (
            <>
              <div>
                <div className="text-[11px] text-mw-ink-4 font-sans mb-[4px]">Referral link</div>
                <RefCodeInput value={refLink!} buttonLabel="Copy Link" />
              </div>
              <div>
                <div className="text-[11px] text-mw-ink-4 font-sans mb-[4px]">Referral code</div>
                <RefCodeInput value={refCode} buttonLabel="Copy Code" ghost />
              </div>
            </>
          )}
          <button
            className="w-full p-3 bg-[#1DA1F2] text-white border-none rounded-md text-[13px] font-semibold font-sans cursor-pointer transition-opacity duration-150 flex items-center justify-center gap-[7px] mt-[4px] active:opacity-80 disabled:opacity-40"
            onClick={shareOnTwitter}
            disabled={!refCode}
            style={{ opacity: refCode ? 1 : 0.4 }}
          >
            <svg width="15" height="13" viewBox="0 0 15 13" fill="none">
              <path d="M14.25 1.5C13.72 1.86 13.14 2.13 12.5 2.3C12.14 1.88 11.66 1.58 11.13 1.45C10.59 1.31 10.03 1.35 9.52 1.56C9.01 1.77 8.58 2.13 8.3 2.6C8.01 3.07 7.87 3.62 7.88 4.17V4.79C6.82 4.82 5.77 4.57 4.83 4.08C3.9 3.59 3.11 2.87 2.54 2C2.54 2 0.29 7 5.29 9.25C4.12 10.03 2.73 10.42 1.29 10.38C6.29 13.25 12.54 10.38 12.54 4.12C12.54 3.97 12.53 3.83 12.51 3.68C13.1 3.09 13.53 2.34 14.25 1.5Z" fill="white"/>
            </svg>
            Share on X
          </button>
        </div>
      </div>

      {/* Referred Wallets */}
      <div className="mw-accent-card rounded-[18px] p-[20px_22px] mb-3 shadow-card">
        <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-mw-brand-deep mb-[14px] font-sans">
          Referred Wallets
        </div>
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <div className="h-[12px] w-[80px] bg-[rgba(26,26,46,0.06)] rounded-[4px] animate-pulse" />
          </div>
        ) : sortedRecords.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-6 pb-3 text-mw-ink-4">
            <div className="text-[26px] opacity-40">◉</div>
            <div className="text-[13px] font-sans text-center max-w-[220px] leading-[1.55]">
              No referrals yet. Share your link to get started.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedRecords.map(r => (
              <div key={r.id} className="flex items-center justify-between p-[10px_14px] bg-mw-surface-purple border-[1.5px] border-mw-border rounded-sm">
                <span className="text-[12px] font-mono text-mw-ink-2">{truncateAddress(r.referred)}</span>
                <span className={`text-[10px] font-bold tracking-[0.4px] px-[9px] py-[3px] rounded-full uppercase ${r.status === 'active' ? 'bg-[rgba(42,158,138,0.12)] text-mw-teal' : 'bg-[rgba(194,122,0,0.1)] text-mw-amber'}`}>
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

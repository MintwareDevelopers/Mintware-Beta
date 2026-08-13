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
      {/* Hero — value prop · dark pop */}
      <div className="relative overflow-hidden rounded-[var(--radius-panel)] p-[28px_28px_24px] mb-3 bg-ink">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 130% at 12% 0%, rgba(244,161,131,0.24), transparent 60%), radial-gradient(50% 120% at 100% 100%, rgba(108,108,240,0.28), transparent 62%)' }} />
        <div className="grain absolute inset-0 opacity-40" aria-hidden />
        <div className="relative">
          <div className="uppercase tracking-[0.1em] text-[10px] font-semibold text-coral2 mb-[10px]">
            Sharing score
          </div>
          <div className="font-atx-display text-[22px] font-medium text-white leading-[1.25] mb-[6px] tracking-[-0.4px]">
            Grow your network,<br />earn more rewards.
          </div>
          <div className="text-[13px] text-white/60 leading-[1.55] mb-[22px] max-w-[320px]">
            Every wallet you refer that stays active raises your Sharing score — which multiplies your reward allocation.
          </div>
          <div className="flex items-center gap-[14px] rounded-2xl bg-white/[0.06] border border-white/15 p-[14px_18px]">
            <div className="text-[36px] font-atx-display font-medium text-coral2 leading-[1] tracking-[-1px] shrink-0 tabular-nums">
              {isLoading ? '—' : sharingScore}<span className="text-[14px] text-white/45"> / 125</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="uppercase tracking-[0.1em] text-[10px] font-semibold text-white/50 mb-[6px]">
                Sharing score
              </div>
              <div className="h-[8px] rounded-full bg-white/15 overflow-hidden relative">
                <div
                  className="h-full bg-coral2 absolute inset-y-0 left-0 rounded-full transition-[width] duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ width: pct + '%' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Why refer */}
      <div className="flex gap-2 mb-3 max-sm:flex-col">
        <div className="soft-card flex-1 p-[12px_14px]">
          <div className="text-[12px] font-semibold text-ink mb-[2px]">Boost your score</div>
          <div className="text-[11px] text-ink-mid leading-[1.4]">Active referrals raise your Sharing score up to 125 pts</div>
        </div>
        <div className="soft-card flex-1 p-[12px_14px]">
          <div className="text-[12px] font-semibold text-ink mb-[2px]">Earn rewards</div>
          <div className="text-[11px] text-ink-mid leading-[1.4]">A stronger Attribution score grows your reward share</div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-3 mb-3">
        <div className="soft-card flex-1 p-[14px_16px] text-center">
          {isLoading
            ? <div className="h-[24px] w-[36px] rounded bg-ground-cool mx-auto mb-[4px] mw-shimmer" />
            : <div className="text-[24px] font-atx-display font-medium tracking-[-0.5px] leading-[1] mb-[4px] text-peri-deep tabular-nums">{treeSize}</div>
          }
          <div className="uppercase tracking-[0.08em] text-[10px] font-semibold text-ink-soft">Referred</div>
        </div>
        <div className="soft-card flex-1 p-[14px_16px] text-center">
          {isLoading
            ? <div className="h-[24px] w-[36px] rounded bg-ground-cool mx-auto mb-[4px] mw-shimmer" />
            : <div className="text-[24px] font-atx-display font-medium tracking-[-0.5px] leading-[1] mb-[4px] text-coral2-deep tabular-nums">{qualityPct}%</div>
          }
          <div className="uppercase tracking-[0.08em] text-[10px] font-semibold text-ink-soft">Active</div>
        </div>
      </div>

      {/* Share Your Link */}
      <div className="soft-card p-[20px_22px] mb-3">
        <div className="uppercase tracking-[0.1em] text-[10px] font-semibold text-peri-deep mb-[14px]">
          Share Your Link
        </div>
        <div className="flex flex-col gap-[10px]">
          {refCode === null ? (
            <div className="flex flex-col gap-2">
              <div className="h-[40px] w-full rounded-xl bg-ground-cool mw-shimmer" />
              <div className="h-[40px] w-[60%] rounded-xl bg-ground-cool mw-shimmer" />
            </div>
          ) : (
            <>
              <div>
                <div className="text-[11px] text-ink-soft mb-[4px]">Referral link</div>
                <RefCodeInput value={refLink!} buttonLabel="Copy Link" />
              </div>
              <div>
                <div className="text-[11px] text-ink-soft mb-[4px]">Referral code</div>
                <RefCodeInput value={refCode} buttonLabel="Copy Code" ghost />
              </div>
            </>
          )}
          <button
            className="glass-pill w-full justify-center mt-[4px] disabled:opacity-40"
            onClick={shareOnTwitter}
            disabled={!refCode}
          >
            Share on X
          </button>
        </div>
      </div>

      {/* Referred Wallets */}
      <div className="soft-card p-[20px_22px] mb-3">
        <div className="uppercase tracking-[0.1em] text-[10px] font-semibold text-peri-deep mb-[14px]">
          Referred Wallets
        </div>
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <div className="h-[12px] w-[80px] rounded bg-ground-cool mw-shimmer" />
          </div>
        ) : sortedRecords.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-6 pb-3 text-ink-soft">
            <div className="text-[13px] text-center max-w-[220px] leading-[1.55]">
              No referrals yet. Share your link to get started.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedRecords.map(r => (
              <div key={r.id} className="flex items-center justify-between p-[10px_14px] rounded-xl bg-ground-cool border border-hair">
                <span className="text-[12px] font-mono text-ink-mid">{truncateAddress(r.referred)}</span>
                <span className={`text-[10px] font-semibold tracking-[0.08em] px-2.5 py-[3px] uppercase rounded-full border ${r.status === 'active' ? 'border-[rgba(108,108,240,0.3)] text-peri-deep' : 'border-[rgba(209,67,67,0.3)] text-[#D14343]'}`}>
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

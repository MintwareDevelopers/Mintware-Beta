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
      <div className="border border-atx-ink p-[28px_28px_24px] mb-3 relative overflow-hidden bg-atx-ink">
        <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-coral mb-[10px]">
          Sharing score
        </div>
        <div className="text-[22px] font-bold text-white leading-[1.25] mb-[6px] tracking-[-0.4px]">
          Grow your network,<br />earn more rewards.
        </div>
        <div className="text-[13px] text-white/60 leading-[1.55] mb-[22px] max-w-[320px]">
          Every wallet you refer that stays active raises your Sharing score — which multiplies your reward allocation.
        </div>
        <div className="flex items-center gap-[14px] bg-white/5 border border-white/20 p-[14px_18px]">
          <div className="text-[36px] font-bold text-atx-coral font-atx-mono leading-[1] tracking-[-1px] shrink-0">
            {isLoading ? '—' : sharingScore}<span className="text-[14px] text-white/45"> / 125</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-white/50 mb-[6px]">
              Sharing score
            </div>
            <div className="h-[8px] border border-white/40 overflow-hidden relative">
              <div
                className="h-full bg-atx-coral absolute inset-y-0 left-0 transition-[width] duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ width: pct + '%' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Why refer */}
      <div className="flex gap-2 mb-3">
        <div className="bg-atx-panel border border-atx-ink/25 flex-1 p-[12px_14px] flex items-start gap-[10px]">
          <svg viewBox="0 0 100 100" className="w-[18px] h-[18px] text-atx-coral mt-[1px] shrink-0" aria-hidden="true"><path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"/></svg>
          <div>
            <div className="text-[12px] font-bold text-atx-ink mb-[2px]">Boost your score</div>
            <div className="text-[11px] text-atx-ink/55 leading-[1.4]">Active referrals raise your Sharing score up to 125 pts</div>
          </div>
        </div>
        <div className="bg-atx-panel border border-atx-ink/25 flex-1 p-[12px_14px] flex items-start gap-[10px]">
          <svg viewBox="0 0 100 100" className="w-[18px] h-[18px] text-atx-coral mt-[1px] shrink-0" aria-hidden="true"><path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"/></svg>
          <div>
            <div className="text-[12px] font-bold text-atx-ink mb-[2px]">Earn rewards</div>
            <div className="text-[11px] text-atx-ink/55 leading-[1.4]">Score multipliers increase your campaign reward allocation</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-3 mb-3">
        <div className="bg-atx-panel border border-atx-ink/25 flex-1 p-[14px_16px] text-center">
          {isLoading
            ? <div className="h-[24px] w-[36px] bg-atx-bone border border-atx-ink/20 mx-auto mb-[4px] animate-pulse" />
            : <div className="text-[24px] font-bold font-atx-mono tracking-[-0.5px] leading-[1] mb-[4px] text-atx-blue">{treeSize}</div>
          }
          <div className="font-atx-mono uppercase tracking-[0.08em] text-[10px] font-semibold text-atx-ink/55">Referred</div>
        </div>
        <div className="bg-atx-panel border border-atx-ink/25 flex-1 p-[14px_16px] text-center">
          {isLoading
            ? <div className="h-[24px] w-[36px] bg-atx-bone border border-atx-ink/20 mx-auto mb-[4px] animate-pulse" />
            : <div className="text-[24px] font-bold font-atx-mono tracking-[-0.5px] leading-[1] mb-[4px] text-atx-mesquite">{qualityPct}%</div>
          }
          <div className="font-atx-mono uppercase tracking-[0.08em] text-[10px] font-semibold text-atx-ink/55">Active</div>
        </div>
      </div>

      {/* Share Your Link */}
      <div className="bg-atx-panel border border-atx-ink p-[20px_22px] mb-3">
        <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-blue mb-[14px]">
          Share Your Link
        </div>
        <div className="flex flex-col gap-[10px]">
          {refCode === null ? (
            <div className="flex flex-col gap-2">
              <div className="h-[40px] w-full bg-atx-bone border border-atx-ink/20 animate-pulse" />
              <div className="h-[40px] w-[60%] bg-atx-bone border border-atx-ink/20 animate-pulse" />
            </div>
          ) : (
            <>
              <div>
                <div className="text-[11px] text-atx-ink/55 mb-[4px]">Referral link</div>
                <RefCodeInput value={refLink!} buttonLabel="Copy Link" />
              </div>
              <div>
                <div className="text-[11px] text-atx-ink/55 mb-[4px]">Referral code</div>
                <RefCodeInput value={refCode} buttonLabel="Copy Code" ghost />
              </div>
            </>
          )}
          <button
            className="w-full p-3 bg-atx-blue text-white border border-atx-ink text-[13px] font-semibold font-atx-mono uppercase tracking-[0.05em] cursor-pointer transition-opacity duration-150 flex items-center justify-center gap-[7px] mt-[4px] active:opacity-80 disabled:opacity-40"
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
      <div className="bg-atx-panel border border-atx-ink p-[20px_22px] mb-3">
        <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-blue mb-[14px]">
          Referred Wallets
        </div>
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <div className="h-[12px] w-[80px] bg-atx-bone border border-atx-ink/20 animate-pulse" />
          </div>
        ) : sortedRecords.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-6 pb-3 text-atx-ink/55">
            <svg viewBox="0 0 100 100" className="w-[26px] h-[26px] text-atx-coral" aria-hidden="true"><path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"/></svg>
            <div className="text-[13px] text-center max-w-[220px] leading-[1.55]">
              No referrals yet. Share your link to get started.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedRecords.map(r => (
              <div key={r.id} className="flex items-center justify-between p-[10px_14px] bg-atx-bone border border-atx-ink/25">
                <span className="text-[12px] font-atx-mono text-atx-ink/60">{truncateAddress(r.referred)}</span>
                <span className={`text-[10px] font-bold tracking-[0.08em] px-[9px] py-[3px] uppercase font-atx-mono border ${r.status === 'active' ? 'border-atx-ink/25 text-atx-mesquite' : 'border-atx-ink/25 text-atx-clay'}`}>
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

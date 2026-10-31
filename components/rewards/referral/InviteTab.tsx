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
      `I'm on @Mintware_Fi — markets for tokenized stocks and real-world assets.\n\nJoin with my link: ${refLink}`
    )
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'noopener')
  }

  const WELL = { background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }
  const LABEL = 'text-[12px] uppercase tracking-[0.08em] font-semibold text-ink-soft'

  return (
    <div className="font-geist flex flex-col gap-4">
      {/* 1 — what inviting does, with the score it moves */}
      <div className="mw-raise-lg relative overflow-hidden rounded-[24px] p-[clamp(20px,3vw,28px)]">
        <div aria-hidden="true" className="absolute -right-24 -top-28 w-80 h-80 rounded-full opacity-30 blur-[56px]" style={{ background: 'var(--mw-sheen)' }} />
        <div className="relative grid gap-6 items-center grid-cols-1 min-[720px]:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mw-peri-deep)' }}>Invite</div>
            <div className="text-[24px] font-semibold tracking-[-0.03em] leading-[1.15] mt-2">Bring people you know.</div>
            <div className="text-[14.5px] text-ink-mid leading-[1.55] mt-2 max-w-[40ch]">Share your link. Each person who joins with it and becomes active raises your Sharing score.</div>
          </div>
          <div className="rounded-[18px] p-4" style={WELL}>
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] text-ink-mid font-medium">Sharing score</span>
              <span className="font-geist-mono text-[28px] tracking-[-0.03em]">{isLoading ? '—' : sharingScore}<span className="text-[14px] text-ink-soft"> / 125</span></span>
            </div>
            <div className="mt-3 h-3 rounded-full overflow-hidden bg-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(21,21,29,.06)' }}>
              <div className="h-full rounded-full transition-[width] duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ width: pct + '%', background: '#7C7AF0' }} />
            </div>
          </div>
        </div>
      </div>

      {/* 2 — where it stands */}
      <div className="grid grid-cols-2 gap-3">
        <div className="mw-raise rounded-[20px] p-4">
          <div className={LABEL}>Referred</div>
          {isLoading
            ? <div className="h-[30px] w-[48px] rounded-md mt-2 mw-shimmer" style={{ background: 'var(--mw-well)' }} />
            : <div className="font-geist-mono text-[28px] tracking-[-0.03em] mt-1">{treeSize}</div>}
        </div>
        <div className="mw-raise rounded-[20px] p-4">
          <div className={LABEL}>Active</div>
          {isLoading
            ? <div className="h-[30px] w-[48px] rounded-md mt-2 mw-shimmer" style={{ background: 'var(--mw-well)' }} />
            : <div className="font-geist-mono text-[28px] tracking-[-0.03em] mt-1">{qualityPct}%</div>}
        </div>
      </div>

      {/* 3 — share */}
      <div className="mw-raise rounded-[22px] p-5">
        <div className={LABEL}>Your link</div>
        <div className="flex flex-col gap-3 mt-3">
          {refCode === null ? (
            <div className="flex flex-col gap-2">
              <div className="h-[44px] w-full rounded-[12px] mw-shimmer" style={{ background: 'var(--mw-well)' }} />
              <div className="h-[44px] w-[60%] rounded-[12px] mw-shimmer" style={{ background: 'var(--mw-well)' }} />
            </div>
          ) : (
            <>
              <div>
                <div className="text-[13px] text-ink-mid mb-1.5">Referral link</div>
                <RefCodeInput value={refLink!} buttonLabel="Copy Link" />
              </div>
              <div>
                <div className="text-[13px] text-ink-mid mb-1.5">Referral code</div>
                <RefCodeInput value={refCode} buttonLabel="Copy Code" ghost />
              </div>
            </>
          )}
          <button
            className="mw-btn-quiet w-full mt-1 disabled:opacity-40"
            onClick={shareOnTwitter}
            disabled={!refCode}
          >
            Share on X
          </button>
        </div>
      </div>

      {/* 4 — who joined */}
      <div className="mw-raise rounded-[22px] p-5">
        <div className={LABEL}>People you referred</div>
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <div className="h-[12px] w-[80px] rounded mw-shimmer" style={{ background: 'var(--mw-well)' }} />
          </div>
        ) : sortedRecords.length === 0 ? (
          <div className="mt-3 rounded-[14px] px-4 py-6 text-center text-[14px] text-ink-mid" style={WELL}>
            No referrals yet. Share your link to get started.
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-3">
            {sortedRecords.map(r => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2.5 rounded-[12px]" style={WELL}>
                <span className="text-[13px] font-geist-mono text-ink-mid">{truncateAddress(r.referred)}</span>
                <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full ${r.status === 'active' ? 'bg-[#E3F4EA] text-[#0F7A43]' : 'bg-white text-ink-mid mw-tex-dots'}`}>
                  {r.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" />}{r.status === 'active' ? 'Active' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

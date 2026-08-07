'use client'

// =============================================================================
// ActionsPanel.tsx — Generic campaign actions renderer for Overview tab
//
// Accepts campaign.actions (Record<string, ActionDef>) and renders each
// action with icon, label, points description, one-liner, and a CTA button.
//
// token_pool: referral mechanic cards — share link, swap via referral
// points:     action cards — bridge, trade, referral actions, hold
//
// Design: ATX Settlemint — square, hairline borders, flat duotone, mono data.
// =============================================================================

import { useState } from 'react'
import Link from 'next/link'
import { SwapModal } from '@/components/rewards/swap/SwapModal'

export interface ActionDef {
  label: string
  points: number
  per_day?: boolean
  one_time?: boolean
  per_referral?: boolean
  per_referred_trade?: boolean
}

interface ActionsPanelProps {
  actions: Record<string, ActionDef>
  startDate?: string
  endDate?: string
  campaignType?: 'token_pool' | 'points'
  referralRewardPct?: number
  buyerRewardPct?: number
  tokenSymbol?: string
  tokenContract?: string
  chainId?: number
  campaignName?: string
  // CTA context — needed for buttons
  isJoined?: boolean
  walletAddress?: string
  campaignId?: string
}

// Icon + description + CTA per action key. `color` is an ATX text-color class.
function actionMeta(key: string): {
  icon: string; color: string; desc: string
  cta?: { label: string; href?: string; copy?: boolean; comingSoon?: boolean; swap?: boolean }
} {
  if (key === 'trade') return {
    icon: '✴', color: 'text-atx-mesquite',
    desc: 'Trade each day on Mintware to accumulate daily points.',
    cta: { label: 'Swap now →', swap: true },
  }
  if (key === 'referral_trade') return {
    icon: '↗', color: 'text-atx-coral',
    desc: 'Earn every time a wallet you referred trades.',
    cta: { label: 'Copy referral link', copy: true },
  }
  if (key === 'hold') return {
    icon: '✴', color: 'text-atx-clay',
    desc: 'Hold assets in your wallet for a bonus multiplier.',
  }
  return { icon: '✴', color: 'text-atx-ink/55', desc: '' }
}

function pointsLabel(action: ActionDef): string {
  if (action.per_day)            return `${action.points} pts/day`
  if (action.per_referral)       return `${action.points} pts/referral`
  if (action.per_referred_trade) return `${action.points} pts/referred trade`
  if (action.one_time)           return `${action.points} pts (one-time)`
  return `${action.points} pts`
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

// ── Small CTA button ──────────────────────────────────────────────────────────
function CtaButton({
  label, href, color, onCopy, onClick,
}: {
  label: string; href?: string; color: string; onCopy?: () => void; onClick?: () => void
}) {
  const cls = `inline-flex items-center px-3 py-[6px] font-atx-mono text-[11px] font-semibold uppercase tracking-[0.05em] border border-atx-ink/30 whitespace-nowrap cursor-pointer no-underline shrink-0 transition-colors duration-150 hover:bg-atx-bone ${color}`

  if (href) {
    return <Link href={href} className={cls}>{label}</Link>
  }
  return (
    <button onClick={onClick ?? onCopy} className={cls}>
      {label}
    </button>
  )
}

// ── Copy hook ─────────────────────────────────────────────────────────────────
function useCopyRef(refLink: string | null) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  function copy(key: string) {
    if (!refLink) return
    navigator.clipboard.writeText(refLink).catch(() => {})
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }
  return { copiedKey, copy }
}

// ── Schedule block ────────────────────────────────────────────────────────────
function ScheduleBlock({ startDate, endDate }: { startDate?: string; endDate?: string }) {
  if (!startDate && !endDate) return null
  return (
    <div className="mt-4 bg-atx-bone border border-atx-ink/20 px-[14px] py-3">
      <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-2">
        Schedule
      </div>
      <div className="flex gap-6 flex-wrap">
        {startDate && (
          <div>
            <div className="font-atx-mono text-[12px] font-semibold text-atx-ink">{fmtDate(startDate)}</div>
            <div className="font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/45 mt-[1px]">Start date</div>
          </div>
        )}
        {endDate && (
          <div>
            <div className="font-atx-mono text-[12px] font-semibold text-atx-ink">{fmtDate(endDate)}</div>
            <div className="font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/45 mt-[1px]">End date</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export function ActionsPanel({
  actions, startDate, endDate, campaignType,
  referralRewardPct, buyerRewardPct, tokenSymbol,
  tokenContract, chainId, campaignName,
  isJoined, walletAddress, campaignId,
}: ActionsPanelProps) {
  const entries = Object.entries(actions)
  const isTokenPool = campaignType === 'token_pool'
  const [swapOpen, setSwapOpen] = useState(false)
  const swapModalEl = (
    <SwapModal
      open={swapOpen}
      onClose={() => setSwapOpen(false)}
      tokenContract={tokenContract}
      chainId={chainId}
      symbol={tokenSymbol}
      campaignId={campaignId}
      campaignName={campaignName}
    />
  )

  // Build ref link for copy buttons
  const refCode = walletAddress ? `mw_${walletAddress.slice(2, 8).toLowerCase()}` : null
  const refLink = (typeof window !== 'undefined' && refCode && campaignId)
    ? `${window.location.origin}/campaign/${campaignId}?ref=${refCode}`
    : null

  const { copiedKey, copy } = useCopyRef(refLink)

  // ── Token Reward Pool ───────────────────────────────────────────────────────
  if (isTokenPool) {
    return (
      <div>
        <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-3">
          How you earn
        </div>

        <div className="flex flex-col gap-2">
          {/* Referral earn */}
          <div className="flex items-center gap-[14px] bg-atx-panel border border-atx-ink/20 px-4 py-[14px] flex-wrap">
            <div className="w-10 h-10 shrink-0 flex items-center justify-center text-[18px] border border-atx-ink/20 text-atx-mesquite">✴</div>
            <div className="flex-1 min-w-0">
              <div className="font-atx-display text-[13px] font-semibold text-atx-ink mb-[2px]">
                Share your referral link
              </div>
              <div className="font-atx-display text-[11px] text-atx-ink/55 leading-[1.4]">
                Earn {referralRewardPct ?? 0}% of every swap your referrals make — automatically, with no cap.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="font-atx-mono text-[12px] font-bold text-atx-mesquite border border-atx-ink/25 px-[10px] py-1 whitespace-nowrap">
                {referralRewardPct ?? 0}% per swap
              </div>
              {isJoined && refLink && (
                <CtaButton
                  label={copiedKey === 'token_ref' ? 'Copied' : 'Copy link'}
                  color='text-atx-mesquite'
                  onCopy={() => copy('token_ref')}
                />
              )}
            </div>
          </div>

          {/* Buyer rebate */}
          {(buyerRewardPct ?? 0) > 0 && (
            <div className="flex items-center gap-[14px] bg-atx-panel border border-atx-ink/20 px-4 py-[14px] flex-wrap">
              <div className="w-10 h-10 shrink-0 flex items-center justify-center text-[18px] border border-atx-ink/20 text-atx-blue">✴</div>
              <div className="flex-1 min-w-0">
                <div className="font-atx-display text-[13px] font-semibold text-atx-ink mb-[2px]">
                  Swap via a referral link
                </div>
                <div className="font-atx-display text-[11px] text-atx-ink/55 leading-[1.4]">
                  Get a small rebate on your own swap when you use someone&apos;s referral link.
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="font-atx-mono text-[12px] font-bold text-atx-blue border border-atx-ink/25 px-[10px] py-1 whitespace-nowrap">
                  {buyerRewardPct ?? 0}% rebate
                </div>
                <CtaButton label='Swap now →' onClick={() => setSwapOpen(true)} color='text-atx-blue' />
              </div>
            </div>
          )}
        </div>

        <ScheduleBlock startDate={startDate} endDate={endDate} />
        {swapModalEl}
      </div>
    )
  }

  // ── Points Campaign ─────────────────────────────────────────────────────────
  if (entries.length === 0) return null

  return (
    <div>
      <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-3">
        Campaign Actions
      </div>

      <div className="flex flex-col gap-2">
        {entries.map(([key, action]) => {
          const meta = actionMeta(key)
          const isCopyAction    = meta.cta?.copy
          const isComingSoon    = meta.cta?.comingSoon
          const copyKey         = `ref_${key}`
          const copied          = copiedKey === copyKey

          // Referral copy actions: only show button if joined
          const showCtaButton = meta.cta && !isComingSoon && (isCopyAction ? isJoined && refLink : true)

          return (
            <div key={key} className={`flex items-center gap-[14px] border border-atx-ink/20 px-4 py-[14px] flex-wrap ${isComingSoon ? 'bg-atx-bone opacity-70' : 'bg-atx-panel'}`}>
              {/* Icon */}
              <div className={`w-10 h-10 shrink-0 flex items-center justify-center text-[18px] border border-atx-ink/20 ${meta.color}`}>
                {meta.icon}
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <div className="font-atx-display text-[13px] font-semibold text-atx-ink mb-[2px]">
                  {action.label}
                </div>
                {meta.desc && (
                  <div className="font-atx-display text-[11px] text-atx-ink/55 leading-[1.4]">
                    {meta.desc}
                  </div>
                )}
              </div>

              {/* Points badge + CTA */}
              <div className="flex items-center gap-2 shrink-0">
                <div className={`font-atx-mono text-[12px] font-bold border border-atx-ink/25 px-[10px] py-1 whitespace-nowrap ${meta.color}`}>
                  +{pointsLabel(action)}
                </div>

                {/* Coming soon tag */}
                {isComingSoon && (
                  <span className="font-atx-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-atx-clay border border-atx-ink/30 px-2 py-1 whitespace-nowrap">
                    Coming soon
                  </span>
                )}

                {/* Active CTA button */}
                {showCtaButton && (
                  <CtaButton
                    label={isCopyAction ? (copied ? 'Copied' : meta.cta!.label) : meta.cta!.label}
                    href={meta.cta!.href}
                    color={meta.color}
                    onCopy={isCopyAction ? () => copy(copyKey) : undefined}
                    onClick={meta.cta?.swap ? () => setSwapOpen(true) : undefined}
                  />
                )}

                {/* Not joined yet — soft prompt for referral actions */}
                {isCopyAction && !isComingSoon && !isJoined && (
                  <span className="font-atx-mono text-[10px] uppercase tracking-[0.06em] text-atx-ink/45 border border-atx-ink/20 px-2 py-1 whitespace-nowrap">
                    join first
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <ScheduleBlock startDate={startDate} endDate={endDate} />
      {swapModalEl}
    </div>
  )
}

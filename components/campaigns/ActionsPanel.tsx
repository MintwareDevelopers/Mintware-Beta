'use client'

// =============================================================================
// ActionsPanel.tsx — Generic campaign actions renderer for Overview tab
//
// Accepts campaign.actions (Record<string, ActionDef>) and renders each
// action with icon, label, points description, one-liner, and a CTA button.
//
// token_pool: referral mechanic cards — share link, swap via referral
// points:     action cards — bridge, trade, referral actions, hold
// =============================================================================

import { useState } from 'react'
import Link from 'next/link'

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
  // CTA context — needed for buttons
  isJoined?: boolean
  walletAddress?: string
  campaignId?: string
}

// Icon + description + CTA per action key
function actionMeta(key: string): {
  icon: string; color: string; bg: string; desc: string
  cta?: { label: string; href?: string; copy?: boolean; comingSoon?: boolean }
} {
  if (key === 'bridge') return {
    icon: '🌉', color: '#3A5CE8', bg: 'rgba(58,92,232,0.08)',
    desc: 'Bridge assets to this chain once to earn points.',
    cta: { label: 'Coming soon', comingSoon: true },
  }
  if (key === 'trade') return {
    icon: '📈', color: '#2A9E8A', bg: 'rgba(42,158,138,0.08)',
    desc: 'Trade each day on Mintware to accumulate daily points.',
    cta: { label: 'Swap now →', href: '/swap' },
  }
  if (key === 'referral_bridge') return {
    icon: '🔗', color: '#7B6FCC', bg: 'rgba(123,111,204,0.08)',
    desc: 'Refer wallets who bridge — earn per successful bridge.',
    cta: { label: 'Coming soon', comingSoon: true },
  }
  if (key === 'referral_trade') return {
    icon: '↗', color: '#C2537A', bg: 'rgba(194,83,122,0.08)',
    desc: 'Earn every time a wallet you referred trades.',
    cta: { label: 'Copy referral link', copy: true },
  }
  if (key === 'hold') return {
    icon: '💎', color: '#C27A00', bg: 'rgba(194,122,0,0.08)',
    desc: 'Hold assets in your wallet for a bonus multiplier.',
  }
  return { icon: '⚡', color: '#8A8C9E', bg: '#F7F6FF', desc: '' }
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
  label, href, color, bg, onCopy,
}: {
  label: string; href?: string; color: string; bg: string; onCopy?: () => void
}) {
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    padding: '6px 12px', borderRadius: 8,
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    fontSize: 11, fontWeight: 600,
    color, background: bg,
    border: `1px solid ${color}33`,
    cursor: 'pointer', whiteSpace: 'nowrap',
    textDecoration: 'none', transition: 'opacity 0.15s',
    flexShrink: 0,
  }

  if (href) {
    return <Link href={href} style={style}>{label}</Link>
  }
  return (
    <button onClick={onCopy} style={{ ...style, border: `1px solid ${color}33` }}>
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
    <div style={{
      marginTop: 16,
      background: '#F7F6FF', border: '1px solid #E0DFFF', borderRadius: 10,
      padding: '12px 14px',
    }}>
      <div style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 10, fontWeight: 700, letterSpacing: '1px',
        textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 8,
      }}>
        Schedule
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {startDate && (
          <div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 600, color: '#1A1A2E' }}>{fmtDate(startDate)}</div>
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 1 }}>Start date</div>
          </div>
        )}
        {endDate && (
          <div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 600, color: '#1A1A2E' }}>{fmtDate(endDate)}</div>
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 1 }}>End date</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export function ActionsPanel({
  actions, startDate, endDate, campaignType,
  referralRewardPct, buyerRewardPct,
  isJoined, walletAddress, campaignId,
}: ActionsPanelProps) {
  const entries = Object.entries(actions)
  const isTokenPool = campaignType === 'token_pool'

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
        <div style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 10, fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 12,
        }}>
          How you earn
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Referral earn */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#fff', border: '1px solid #E0DFFF', borderRadius: 12,
            padding: '14px 16px', flexWrap: 'wrap',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'rgba(42,158,138,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>◉</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 2 }}>
                Share your referral link
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, color: '#8A8C9E', lineHeight: 1.4 }}>
                Earn {referralRewardPct ?? 0}% of every swap your referrals make — automatically, with no cap.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{
                fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 700,
                color: '#2A9E8A', background: 'rgba(42,158,138,0.08)',
                borderRadius: 8, padding: '4px 10px', whiteSpace: 'nowrap',
              }}>
                {referralRewardPct ?? 0}% per swap
              </div>
              {isJoined && refLink && (
                <CtaButton
                  label={copiedKey === 'token_ref' ? '✓ Copied!' : 'Copy link'}
                  color='#2A9E8A' bg='rgba(42,158,138,0.08)'
                  onCopy={() => copy('token_ref')}
                />
              )}
            </div>
          </div>

          {/* Buyer rebate */}
          {(buyerRewardPct ?? 0) > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: '#fff', border: '1px solid #E0DFFF', borderRadius: 12,
              padding: '14px 16px', flexWrap: 'wrap',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: 'rgba(58,92,232,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}>⇄</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 2 }}>
                  Swap via a referral link
                </div>
                <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, color: '#8A8C9E', lineHeight: 1.4 }}>
                  Get a small rebate on your own swap when you use someone&apos;s referral link.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div style={{
                  fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 700,
                  color: '#3A5CE8', background: 'rgba(58,92,232,0.08)',
                  borderRadius: 8, padding: '4px 10px', whiteSpace: 'nowrap',
                }}>
                  {buyerRewardPct ?? 0}% rebate
                </div>
                <CtaButton label='Swap now →' href='/swap' color='#3A5CE8' bg='rgba(58,92,232,0.08)' />
              </div>
            </div>
          )}
        </div>

        <ScheduleBlock startDate={startDate} endDate={endDate} />
      </div>
    )
  }

  // ── Points Campaign ─────────────────────────────────────────────────────────
  if (entries.length === 0) return null

  return (
    <div>
      <div style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 10, fontWeight: 700, letterSpacing: '1px',
        textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 12,
      }}>
        Campaign Actions
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map(([key, action]) => {
          const meta = actionMeta(key)
          const isCopyAction    = meta.cta?.copy
          const isComingSoon    = meta.cta?.comingSoon
          const copyKey         = `ref_${key}`
          const copied          = copiedKey === copyKey

          // Referral copy actions: only show button if joined
          const showCtaButton = meta.cta && !isComingSoon && (isCopyAction ? isJoined && refLink : true)

          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: isComingSoon ? '#FAFAFA' : '#fff',
              border: '1px solid #E0DFFF', borderRadius: 12,
              padding: '14px 16px', flexWrap: 'wrap',
              opacity: isComingSoon ? 0.7 : 1,
            }}>
              {/* Icon */}
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: meta.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}>
                {meta.icon}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 2 }}>
                  {action.label}
                </div>
                {meta.desc && (
                  <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, color: '#8A8C9E', lineHeight: 1.4 }}>
                    {meta.desc}
                  </div>
                )}
              </div>

              {/* Points badge + CTA */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div style={{
                  fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 700,
                  color: meta.color, background: meta.bg,
                  borderRadius: 8, padding: '4px 10px', whiteSpace: 'nowrap',
                }}>
                  +{pointsLabel(action)}
                </div>

                {/* Coming soon tag */}
                {isComingSoon && (
                  <span style={{
                    fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, fontWeight: 600,
                    color: '#8A8C9E', background: '#F7F6FF',
                    border: '1px solid #E0DFFF', borderRadius: 6,
                    padding: '4px 8px', whiteSpace: 'nowrap',
                  }}>
                    Coming soon
                  </span>
                )}

                {/* Active CTA button */}
                {showCtaButton && (
                  <CtaButton
                    label={isCopyAction ? (copied ? '✓ Copied!' : meta.cta!.label) : meta.cta!.label}
                    href={meta.cta!.href}
                    color={meta.color}
                    bg={meta.bg}
                    onCopy={isCopyAction ? () => copy(copyKey) : undefined}
                  />
                )}

                {/* Not joined yet — soft prompt for referral actions */}
                {isCopyAction && !isComingSoon && !isJoined && (
                  <span style={{
                    fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10,
                    color: '#8A8C9E', background: '#F7F6FF',
                    border: '1px solid #E0DFFF', borderRadius: 6,
                    padding: '4px 8px', whiteSpace: 'nowrap',
                  }}>
                    join first
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <ScheduleBlock startDate={startDate} endDate={endDate} />
    </div>
  )
}

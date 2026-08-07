'use client'

// =============================================================================
// ParticipantStats.tsx — "Your Stats" tab on campaign detail
//
// Shows points breakdown, score multiplier, active trading days,
// referral stats (tree_size, tree_quality), total earned, and share link.
// Only rendered when wallet has joined the campaign (participant !== null).
//
// Design: ATX Settlemint — square, hairline rules, mono data values.
// =============================================================================

import { fmtUSD } from '@/lib/web2/api'

export interface Participant {
  attribution_score: number
  score_multiplier?: string | number  // optional — legacy field, may be absent for new participants
  total_points: number
  total_earned_usd: string | number
  trading_points?: number
  referral_trade_points?: number
  active_trading_days?: number
  tree_size?: number
  tree_quality?: string | number
  ref_link?: string
}

interface ParticipantStatsProps {
  participant: Participant
  campaignId: string
  walletAddress?: string
  refCode?: string | null  // from useReferral hook — basename-first format
}

function StatRow({ label, value, mono = true }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-[10px] border-b border-atx-ink/15">
      <span className="font-atx-display text-[13px] text-atx-ink/55">
        {label}
      </span>
      <span className={`${mono ? 'font-atx-mono' : 'font-atx-display'} text-[13px] font-semibold text-atx-ink`}>
        {value}
      </span>
    </div>
  )
}

export function ParticipantStats({ participant: p, campaignId, walletAddress, refCode }: ParticipantStatsProps) {
  // score_multiplier is a legacy DB field — only show if present and meaningfully > 1
  const mult = p.score_multiplier != null
    ? (typeof p.score_multiplier === 'string' ? parseFloat(p.score_multiplier) : p.score_multiplier)
    : null

  // Use DB ref code (basename-first) if available, fall back to address-derived code
  const effectiveRefCode = refCode
    ?? (walletAddress ? `mw_${walletAddress.slice(2, 8).toLowerCase()}` : null)

  const refLink = p.ref_link
    ?? (typeof window !== 'undefined' && effectiveRefCode
      ? `${window.location.origin}/ref/${effectiveRefCode}`
      : '')

  async function copyRefLink() {
    if (!refLink) return
    try { await navigator.clipboard.writeText(refLink) }
    catch { /* silent */ }
  }

  return (
    <div className="flex flex-col gap-5">

      {/* Points breakdown */}
      <div className="bg-atx-panel border border-atx-ink/20 px-[18px] py-4">
        <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-1">
          Points Breakdown
        </div>

        {p.trading_points != null && p.trading_points > 0 && (
          <StatRow label="Trading points"          value={p.trading_points.toLocaleString()} />
        )}
        {p.referral_trade_points != null && p.referral_trade_points > 0 && (
          <StatRow label="Referral trade pts"      value={p.referral_trade_points.toLocaleString()} />
        )}

        {/* Total */}
        <div className="flex items-center justify-between pt-[10px] mt-[2px]">
          <span className="font-atx-display text-[14px] font-bold text-atx-ink">
            Total points
          </span>
          <span className="font-atx-mono text-[18px] font-bold text-atx-blue">
            {p.total_points.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Earnings + multiplier */}
      <div className="bg-atx-panel border border-atx-ink/20 px-[18px] py-4">
        <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-1">
          Earnings & Activity
        </div>

        <StatRow label="Total earned"        value={fmtUSD(Number(p.total_earned_usd))} />
        <StatRow label="Attribution score"   value={p.attribution_score} />
        {mult != null && mult > 1 && (
          <StatRow label="Score multiplier"  value={`${mult.toFixed(2)}×`} />
        )}
        {p.active_trading_days != null && p.active_trading_days > 0 && (
          <StatRow label="Active trading days" value={p.active_trading_days} />
        )}
      </div>

      {/* Referral stats */}
      {(p.tree_size != null || p.tree_quality != null) && (
        <div className="bg-atx-panel border border-atx-ink/20 px-[18px] py-4">
          <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-1">
            Referral Network
          </div>

          {p.tree_size != null && (
            <StatRow label="Network size"    value={`${p.tree_size} wallets`} />
          )}
          {p.tree_quality != null && (
            <StatRow label="Network quality" value={`${parseFloat(String(p.tree_quality)).toFixed(2)}`} />
          )}
        </div>
      )}

      {/* Share link */}
      {refLink && (
        <div className="bg-atx-bone border border-atx-ink/20 px-4 py-[14px]">
          <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55 mb-[10px]">
            Your referral link
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex-1 font-atx-mono text-[11px] text-atx-ink/70 bg-atx-panel border border-atx-ink/20 px-[10px] py-2 overflow-hidden text-ellipsis whitespace-nowrap">
              {refLink}
            </div>
            <button
              onClick={copyRefLink}
              className="shrink-0 px-[14px] py-2 bg-atx-blue text-white border border-atx-ink cursor-pointer font-atx-mono text-[12px] font-semibold uppercase tracking-[0.04em] transition-colors duration-150 hover:bg-atx-ink"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

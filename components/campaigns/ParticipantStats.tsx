'use client'

// =============================================================================
// ParticipantStats.tsx — "Your Stats" tab on campaign detail
//
// Shows points breakdown, score multiplier, active trading days,
// referral stats (tree_size, tree_quality), total earned, and share link.
// Only rendered when wallet has joined the campaign (participant !== null).
// =============================================================================

import { fmtUSD } from '@/lib/api'

export interface Participant {
  attribution_score: number
  score_multiplier: string | number
  total_points: number
  total_earned_usd: string | number
  bridge_points?: number
  trading_points?: number
  referral_bridge_points?: number
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
}

function StatRow({ label, value, mono = true }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: '1px solid #F0EFFF',
    }}>
      <span style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 13, color: '#8A8C9E',
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: mono ? 'DM Mono, monospace' : 'Plus Jakarta Sans, sans-serif',
        fontSize: 13, fontWeight: 600, color: '#1A1A2E',
      }}>
        {value}
      </span>
    </div>
  )
}

export function ParticipantStats({ participant: p, campaignId, walletAddress }: ParticipantStatsProps) {
  const mult = typeof p.score_multiplier === 'string'
    ? parseFloat(p.score_multiplier)
    : p.score_multiplier ?? 1

  // ref_code is deterministic: "mw_" + first 6 chars of address (after 0x), lowercase
  const refCode = walletAddress
    ? `mw_${walletAddress.slice(2, 8).toLowerCase()}`
    : null

  const refLink = p.ref_link
    ?? (typeof window !== 'undefined' && refCode
      ? `${window.location.origin}/campaign/${campaignId}?ref=${refCode}`
      : '')

  async function copyRefLink() {
    if (!refLink) return
    try { await navigator.clipboard.writeText(refLink) }
    catch { /* silent */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Points breakdown */}
      <div style={{ background: '#fff', border: '1px solid #E0DFFF', borderRadius: 14, padding: '16px 18px' }}>
        <div style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 10, fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 4,
        }}>
          Points Breakdown
        </div>

        {p.bridge_points != null && p.bridge_points > 0 && (
          <StatRow label="Bridge points"           value={p.bridge_points.toLocaleString()} />
        )}
        {p.trading_points != null && p.trading_points > 0 && (
          <StatRow label="Trading points"          value={p.trading_points.toLocaleString()} />
        )}
        {p.referral_bridge_points != null && p.referral_bridge_points > 0 && (
          <StatRow label="Referral bridge pts"     value={p.referral_bridge_points.toLocaleString()} />
        )}
        {p.referral_trade_points != null && p.referral_trade_points > 0 && (
          <StatRow label="Referral trade pts"      value={p.referral_trade_points.toLocaleString()} />
        )}

        {/* Total */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: 10, marginTop: 2,
        }}>
          <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, fontWeight: 700, color: '#1A1A2E' }}>
            Total points
          </span>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 700, color: '#3A5CE8' }}>
            {p.total_points.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Earnings + multiplier */}
      <div style={{ background: '#fff', border: '1px solid #E0DFFF', borderRadius: 14, padding: '16px 18px' }}>
        <div style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 10, fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 4,
        }}>
          Earnings & Activity
        </div>

        <StatRow label="Total earned"        value={fmtUSD(Number(p.total_earned_usd))} />
        <StatRow label="Attribution score"   value={p.attribution_score} />
        <StatRow label="Score multiplier"    value={`${mult.toFixed(2)}×`} />
        {p.active_trading_days != null && (
          <StatRow label="Active trading days" value={p.active_trading_days} />
        )}
      </div>

      {/* Referral stats */}
      {(p.tree_size != null || p.tree_quality != null) && (
        <div style={{ background: '#fff', border: '1px solid #E0DFFF', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 10, fontWeight: 700, letterSpacing: '1px',
            textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 4,
          }}>
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
        <div style={{ background: '#F7F6FF', border: '1px solid #E0DFFF', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 10, fontWeight: 700, letterSpacing: '1px',
            textTransform: 'uppercase', color: '#8A8C9E', marginBottom: 10,
          }}>
            Your referral link
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{
              flex: 1, fontFamily: 'DM Mono, monospace', fontSize: 11,
              color: '#3A3C52', background: '#fff', border: '1px solid #E0DFFF',
              borderRadius: 8, padding: '8px 10px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {refLink}
            </div>
            <button
              onClick={copyRefLink}
              style={{
                flexShrink: 0, padding: '8px 14px',
                background: '#3A5CE8', color: '#fff', border: 'none',
                borderRadius: 8, cursor: 'pointer',
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontSize: 12, fontWeight: 600,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#2a4cd8' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#3A5CE8' }}
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

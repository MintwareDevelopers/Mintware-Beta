'use client'

// =============================================================================
// CampaignHeader.tsx — Hero header block for /campaign/[id]
//
// Shows: protocol initial (icon), campaign name, chain badge, status badge,
//        pool size, daily payout, days remaining, progress bar.
// =============================================================================

import { fmtUSD, daysUntil, iconColor } from '@/lib/api'
import type { Campaign } from './CampaignCard'

interface CampaignHeaderProps {
  campaign: Campaign
  poolUsed?: number   // optional: for progress bar
}

export function CampaignHeader({ campaign: c, poolUsed }: CampaignHeaderProps) {
  const col     = iconColor(c.name)
  const initial = (c.protocol ?? c.name).charAt(0).toUpperCase()
  const isLive     = c.status === 'live'
  const isUpcoming = c.status === 'upcoming'
  const daysLeft   = c.end_date ? daysUntil(c.end_date) : null
  const progress   = (c.pool_usd && poolUsed != null)
    ? Math.min(100, (poolUsed / c.pool_usd) * 100)
    : null

  return (
    <>
      <style>{`
        @keyframes dot-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      <div style={{
        background: '#fff',
        border: '1px solid #E0DFFF',
        borderRadius: 18,
        padding: '24px',
        marginBottom: 24,
      }}>
        {/* ── Top row: icon + name + badges ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          {/* Protocol icon */}
          <div style={{
            width: 56, height: 56, borderRadius: 14, flexShrink: 0,
            background: col.bg, color: col.fg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 700,
          }}>
            {initial}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Name */}
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 22, fontWeight: 800, color: '#1A1A2E', marginBottom: 6,
            }}>
              {c.name}
              {c.protocol && c.protocol !== c.name && (
                <span style={{ fontSize: 14, fontWeight: 500, color: '#8A8C9E', marginLeft: 8 }}>
                  by {c.protocol}
                </span>
              )}
            </div>

            {/* Badges row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Chain badge */}
              <span style={{
                fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, fontWeight: 700,
                background: '#EEF1FF', color: '#3A5CE8',
                borderRadius: 6, padding: '3px 8px',
              }}>
                {c.chain}
              </span>

              {/* Status badge */}
              {isLive && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 700,
                  background: 'rgba(42,158,138,0.10)', color: '#2A9E8A',
                  border: '1px solid rgba(42,158,138,0.2)',
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#2A9E8A',
                    display: 'inline-block', animation: 'dot-pulse 2s ease-in-out infinite',
                  }} />
                  Live
                </span>
              )}
              {isUpcoming && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 700,
                  background: 'rgba(194,122,0,0.10)', color: '#C27A00',
                  border: '1px solid rgba(194,122,0,0.2)',
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  ◷ Coming soon
                </span>
              )}
              {c.status === 'ended' && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: '#8A8C9E',
                  background: 'rgba(138,140,158,0.1)',
                  border: '1px solid rgba(138,140,158,0.2)',
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  Ended
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div style={{
          display: 'flex', gap: 0, marginTop: 22,
          background: '#F7F6FF', borderRadius: 12,
          border: '1px solid #E0DFFF', overflow: 'hidden',
        }}>
          {[
            c.pool_usd != null && {
              label: 'Pool size',
              value: `${fmtUSD(c.pool_usd)}${c.token_symbol ? ` ${c.token_symbol}` : ''}`,
            },
            c.daily_payout_usd != null && {
              label: 'Daily payout',
              value: `${fmtUSD(c.daily_payout_usd)}/day`,
            },
            daysLeft !== null && isLive && {
              label: 'Days remaining',
              value: `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
            },
            c.min_score != null && {
              label: 'Min score',
              value: `${c.min_score}+`,
            },
          ].filter(Boolean).map((stat, i, arr) => {
            if (!stat) return null
            return (
              <div key={i} style={{
                flex: 1, padding: '14px 16px',
                borderRight: i < arr.length - 1 ? '1px solid #E0DFFF' : 'none',
              }}>
                <div style={{
                  fontFamily: 'DM Mono, monospace',
                  fontSize: 15, fontWeight: 700, color: '#1A1A2E', marginBottom: 2,
                }}>
                  {(stat as { value: string }).value}
                </div>
                <div style={{
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontSize: 10, color: '#8A8C9E',
                }}>
                  {(stat as { label: string }).label}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Progress bar ── */}
        {progress !== null && (
          <div style={{ marginTop: 16 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginBottom: 6,
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, color: '#8A8C9E',
            }}>
              <span>Pool utilization</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: '#3A5CE8' }}>
                {progress.toFixed(1)}%
              </span>
            </div>
            <div style={{
              height: 6, background: '#E0DFFF', borderRadius: 3, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${progress}%`,
                background: progress > 80 ? '#C2537A' : '#3A5CE8',
                borderRadius: 3, transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

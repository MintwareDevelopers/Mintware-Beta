'use client'

// =============================================================================
// components/swap/SwapCampaignPanel.tsx
// Left column of the Swap page — shows active campaign banner, per-action
// point cards, and supported LI.FI routes.
// =============================================================================

import { useState, useEffect } from 'react'
import { API, fmtUSD, daysUntil } from '@/lib/api'
import type { Campaign } from '@/components/campaigns/CampaignCard'

type ActionDef = NonNullable<Campaign['actions']>[string]

function actionMeta(key: string): { icon: string; color: string; bg: string; border: string } {
  if (key === 'trade')             return { icon: '◈', color: '#2A9E8A', bg: 'rgba(42,158,138,0.07)',  border: 'rgba(42,158,138,0.18)'  }
  if (key === 'bridge')            return { icon: '⇄', color: '#3A5CE8', bg: 'rgba(58,92,232,0.07)',   border: 'rgba(58,92,232,0.18)'   }
  if (key.startsWith('referral'))  return { icon: '◉', color: '#7B6FCC', bg: 'rgba(123,111,204,0.07)', border: 'rgba(123,111,204,0.18)' }
  if (key === 'hold')              return { icon: '◆', color: '#C27A00', bg: 'rgba(194,122,0,0.07)',   border: 'rgba(194,122,0,0.18)'   }
  return                                  { icon: '⬡', color: '#3A5CE8', bg: 'rgba(58,92,232,0.07)',   border: 'rgba(58,92,232,0.18)'   }
}

function actionSuffix(action: ActionDef): string {
  if (action.per_day)            return '/day'
  if (action.per_referral)       return '/ref'
  if (action.per_referred_trade) return '/trade'
  return ''
}

const ROUTES = [
  { from: 'Base',     to: 'Base',     live: true  },
  { from: 'Base',     to: 'Core DAO', live: true  },
  { from: 'Core DAO', to: 'Base',     live: true  },
  { from: 'Core DAO', to: 'Core DAO', live: true  },
]

export function SwapCampaignPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    fetch(`${API}/campaigns`)
      .then(r => r.json())
      .then(data => setCampaigns(Array.isArray(data) ? data : (data.campaigns ?? [])))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const live     = campaigns.find(c => c.status === 'live')
  const actions  = live?.actions ? Object.entries(live.actions) : []
  const daysLeft = live?.end_date ? daysUntil(live.end_date) : null

  return (
    <>
      <style>{`
        .scp-banner {
          background: #1A1A2E;
          border-radius: 20px;
          padding: 22px 24px;
          margin-bottom: 16px;
          position: relative;
          overflow: hidden;
        }
        .scp-banner::before {
          content: '';
          position: absolute;
          top: -40px; right: -40px;
          width: 180px; height: 180px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(58,92,232,0.22) 0%, transparent 70%);
          pointer-events: none;
        }
        .scp-label {
          font-size: 10px; font-weight: 700;
          letter-spacing: 1.2px; text-transform: uppercase;
          color: #8A8C9E; margin-bottom: 10px;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .scp-action-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 18px;
        }
        .scp-action-card {
          border-radius: 14px;
          padding: 14px 16px;
          border: 1.5px solid;
        }
        .scp-route-list { display: flex; flex-direction: column; gap: 6px; }
        .scp-route-row {
          display: flex; align-items: center; justify-content: space-between;
          background: #fff; border: 1px solid rgba(26,26,46,0.08);
          border-radius: 10px; padding: 10px 14px;
        }
      `}</style>

      {/* ── Active campaign banner ─────────────────────────────────────────── */}
      <div className="scp-banner">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'rgba(42,158,138,0.15)', border: '1px solid rgba(42,158,138,0.25)',
            borderRadius: 20, padding: '3px 10px', marginBottom: 12,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#2A9E8A', display: 'inline-block' }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#2A9E8A', fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '0.4px' }}>
              {loading ? 'Loading…' : live ? 'Campaign live' : 'No active campaign'}
            </span>
          </div>

          {live ? (
            <>
              <div style={{
                fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.92)',
                fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '-0.3px', marginBottom: 4,
              }}>
                {live.name}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontFamily: 'Plus Jakarta Sans, sans-serif', marginBottom: 16 }}>
                {live.chain}{daysLeft !== null ? ` · ${daysLeft}d remaining` : ''}
              </div>
              <div style={{ display: 'flex', gap: 24 }}>
                {live.pool_usd != null && (
                  <div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 17, fontWeight: 600, color: '#fff' }}>
                      {fmtUSD(live.pool_usd)}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'Plus Jakarta Sans, sans-serif', marginTop: 2 }}>pool size</div>
                  </div>
                )}
                {live.daily_payout_usd != null && (
                  <div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 17, fontWeight: 600, color: '#4ade80' }}>
                      {fmtUSD(live.daily_payout_usd)}<span style={{ fontSize: 11, color: 'rgba(74,222,128,0.45)', fontWeight: 400 }}>/day</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'Plus Jakarta Sans, sans-serif', marginTop: 2 }}>daily payout</div>
                  </div>
                )}
              </div>
            </>
          ) : !loading ? (
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              No campaigns are currently live. Check back soon.
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Earn points by action ──────────────────────────────────────────── */}
      {actions.length > 0 && (
        <>
          <div className="scp-label">Earn points by action</div>
          <div className="scp-action-grid">
            {actions.map(([key, action]) => {
              const { icon, color, bg, border } = actionMeta(key)
              return (
                <div key={key} className="scp-action-card" style={{ background: bg, borderColor: border }}>
                  <div style={{ fontSize: 20, marginBottom: 8, lineHeight: 1 }}>{icon}</div>
                  <div style={{
                    fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 700,
                    color: '#1A1A2E', marginBottom: 3,
                  }}>
                    {action.label}
                  </div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color }}>
                    +{action.points} pts{actionSuffix(action)}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Supported routes ──────────────────────────────────────────────── */}
      <div className="scp-label">Supported routes</div>
      <div className="scp-route-list">
        {ROUTES.map((r, i) => (
          <div key={i} className="scp-route-row">
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600, color: '#1A1A2E' }}>
              {r.from} <span style={{ color: '#8A8C9E' }}>→</span> {r.to}
            </div>
            <span style={{
              fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 9px',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              background: r.live ? 'rgba(42,158,138,0.10)' : 'rgba(138,140,158,0.10)',
              color:      r.live ? '#2A9E8A'               : '#8A8C9E',
              border:     `1px solid ${r.live ? 'rgba(42,158,138,0.2)' : 'rgba(138,140,158,0.2)'}`,
            }}>
              {r.live ? 'Live' : 'Coming soon'}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

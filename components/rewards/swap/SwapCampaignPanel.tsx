'use client'

// =============================================================================
// components/swap/SwapCampaignPanel.tsx
// Left column of the Swap page — shows active campaign banner, per-action
// point cards, and supported LI.FI routes.
// =============================================================================

import { useState, useEffect } from 'react'
import { API, fmtUSD, daysUntil } from '@/lib/web2/api'
import type { Campaign } from '@/components/rewards/campaigns/CampaignCard'

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
      {/* ── Active campaign banner ─────────────────────────────────────────── */}
      <div className="bg-mw-dark rounded-xl px-[24px] py-[22px] mb-[16px] relative overflow-hidden before:content-[''] before:absolute before:top-[-40px] before:right-[-40px] before:w-[180px] before:h-[180px] before:rounded-full before:bg-[radial-gradient(circle,rgba(58,92,232,0.22)_0%,transparent_70%)] before:pointer-events-none">
        <div className="relative z-[1]">
          <div className="inline-flex items-center gap-[5px] bg-[rgba(42,158,138,0.15)] border border-[rgba(42,158,138,0.25)] rounded-xl px-[10px] py-[3px] mb-[12px]">
            <span className="w-[5px] h-[5px] rounded-full bg-mw-teal inline-block" />
            <span className="text-[10px] font-bold text-mw-teal font-sans tracking-[0.4px]">
              {loading ? 'Loading…' : live ? 'Campaign live' : 'No active campaign'}
            </span>
          </div>

          {live ? (
            <>
              <div className="text-[20px] font-bold text-[rgba(255,255,255,0.92)] font-sans tracking-[-0.3px] mb-[4px]">
                {live.name}
              </div>
              <div className="text-[12px] text-[rgba(255,255,255,0.35)] font-sans mb-[16px]">
                {live.chain}{daysLeft !== null ? ` · ${daysLeft}d remaining` : ''}
              </div>
              <div className="flex gap-[24px]">
                {live.pool_usd != null && (
                  <div>
                    <div className="font-mono text-[17px] font-semibold text-white">
                      {fmtUSD(live.pool_usd)}
                    </div>
                    <div className="text-[10px] text-[rgba(255,255,255,0.28)] font-sans mt-[2px]">pool size</div>
                  </div>
                )}
                {live.daily_payout_usd != null && (
                  <div>
                    <div className="font-mono text-[17px] font-semibold text-[#4ade80]">
                      {fmtUSD(live.daily_payout_usd)}<span className="text-[11px] text-[rgba(74,222,128,0.45)] font-normal">/day</span>
                    </div>
                    <div className="text-[10px] text-[rgba(255,255,255,0.28)] font-sans mt-[2px]">daily payout</div>
                  </div>
                )}
              </div>
            </>
          ) : !loading ? (
            <div className="text-[14px] text-[rgba(255,255,255,0.4)] font-sans">
              No campaigns are currently live. Check back soon.
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Earn points by action ──────────────────────────────────────────── */}
      {actions.length > 0 && (
        <>
          <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-mw-ink-4 mb-[10px] font-sans">
            Earn points by action
          </div>
          <div className="grid grid-cols-2 gap-[8px] mb-[18px]">
            {actions.map(([key, action]) => {
              const { icon, color, bg, border } = actionMeta(key)
              return (
                <div
                  key={key}
                  className="rounded-[14px] px-[16px] py-[14px] border-[1.5px]"
                  style={{ background: bg, borderColor: border }}
                >
                  <div className="text-[20px] mb-[8px] leading-none">{icon}</div>
                  <div className="font-sans text-[13px] font-bold text-mw-ink mb-[3px]">
                    {action.label}
                  </div>
                  <div className="font-mono text-[13px] font-bold" style={{ color }}>
                    +{action.points} pts{actionSuffix(action)}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Supported routes ──────────────────────────────────────────────── */}
      <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-mw-ink-4 mb-[10px] font-sans">
        Supported routes
      </div>
      <div className="flex flex-col gap-[6px]">
        {ROUTES.map((r, i) => (
          <div key={i} className="flex items-center justify-between bg-white border border-[rgba(26,26,46,0.08)] rounded-[10px] px-[14px] py-[10px]">
            <div className="font-sans text-[13px] font-semibold text-mw-ink">
              {r.from} <span className="text-mw-ink-4">→</span> {r.to}
            </div>
            <span
              className="text-[10px] font-bold rounded-xl px-[9px] py-[2px] font-sans border"
              style={{
                background: r.live ? 'rgba(42,158,138,0.10)' : 'rgba(138,140,158,0.10)',
                color:      r.live ? '#2A9E8A'               : '#8A8C9E',
                borderColor: r.live ? 'rgba(42,158,138,0.2)' : 'rgba(138,140,158,0.2)',
              }}
            >
              {r.live ? 'Live' : 'Coming soon'}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

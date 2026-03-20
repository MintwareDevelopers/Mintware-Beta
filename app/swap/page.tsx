'use client'

import { Suspense, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { MwNav } from '@/components/MwNav'
import { SwapWidget } from '@/components/swap/SwapWidget'
import { API } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Campaign {
  id: string
  name: string
  chain: string
  status: string
  actions?: Record<string, {
    label: string
    points: number
    per_day?: boolean
    per_referral?: boolean
    per_referred_trade?: boolean
    one_time?: boolean
  }>
}

interface Participant {
  trading_points?:         number
  bridge_points?:          number
  referral_trade_points?:  number
  referral_bridge_points?: number
  total_points?:           number
  active_trading_days?:    number
}

const ACTION_FIELD_MAP: Record<string, keyof Participant> = {
  trade:           'trading_points',
  bridge:          'bridge_points',
  referral_trade:  'referral_trade_points',
  referral_bridge: 'referral_bridge_points',
}

type ActionValue = NonNullable<Campaign['actions']>[string]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function actionSuffix(a: ActionValue): string {
  if (a.per_day)            return '/day'
  if (a.per_referral)       return '/ref'
  if (a.per_referred_trade) return '/trade'
  return ''
}

function actionDesc(key: string, campaignName: string): string {
  if (key === 'trade')                                         return `Swap any token on ${campaignName} to earn daily points`
  if (key === 'bridge')                                        return `Bridge from Base or Ethereum to ${campaignName} for bonus points`
  if (key.startsWith('referral') && key.includes('trade'))    return `Earn points for every wallet that trades via your invite link`
  if (key.startsWith('referral'))                             return `One-time bonus when a referred wallet completes a full trade`
  return `Complete this action on ${campaignName}`
}

// ─── Swap Page ─────────────────────────────────────────────────────────────────
export default function SwapPage() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''

  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null)
  const [participant, setParticipant]       = useState<Participant | null>(null)

  useEffect(() => {
    fetch(`${API}/campaigns`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setActiveCampaign(data.find((c: Campaign) => c.status === 'live') ?? null)
        }
      })
      .catch(() => {})
  }, [])

  // Fetch participant data when campaign + wallet are known
  useEffect(() => {
    if (!activeCampaign || !wallet) { setParticipant(null); return }
    fetch(`${API}/campaign?id=${encodeURIComponent(activeCampaign.id)}&address=${wallet}`)
      .then(r => r.json())
      .then((d: { participant?: Participant }) => setParticipant(d.participant ?? null))
      .catch(() => {})
  }, [activeCampaign, wallet])

  function actionPts(key: string): number {
    const field = ACTION_FIELD_MAP[key]
    return field ? (participant?.[field] ?? 0) : 0
  }

  function actionBarPct(key: string, action: ActionValue): number {
    const earned = actionPts(key)
    if (earned === 0) return 0
    if (action.one_time) return 100
    const cap = action.per_referral || action.per_referred_trade
      ? action.points * 10   // 10 referrals = 100%
      : action.points * 30   // 30 days = 100%
    return Math.min(Math.round((earned / cap) * 100), 100)
  }

  const actions = activeCampaign?.actions ? Object.entries(activeCampaign.actions) : []

  return (
    <MwAuthGuard>
      <MwNav />
      <>
        <style>{`
          .sw-layout {
            display: grid;
            grid-template-columns: 1fr 380px;
            min-height: calc(100vh - 49px);
          }

          /* ── Left panel ── */
          .sw-left { padding: 32px; border-right: 0.5px solid var(--color-mw-border); }

          .sw-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; color: var(--color-mw-brand); letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 10px; font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-tag-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-mw-live); }
          .sw-title { font-size: 28px; font-weight: 600; letter-spacing: -0.5px; color: var(--color-mw-ink); margin-bottom: 6px; font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-title span { color: var(--color-mw-brand); }
          .sw-sub { font-size: 14px; color: var(--color-mw-ink-3); margin-bottom: 28px; line-height: 1.55; font-family: 'Plus Jakarta Sans', sans-serif; }

          .sw-banner { background: var(--color-mw-brand-dim); border: 0.5px solid rgba(79,126,247,0.2); border-radius: var(--radius-md); padding: 16px 18px; margin-bottom: 24px; display: flex; align-items: center; gap: 14px; }
          .sw-banner-icon { font-size: 22px; flex-shrink: 0; }
          .sw-banner-body { flex: 1; min-width: 0; }
          .sw-banner-title { font-size: 13px; font-weight: 600; color: var(--color-mw-ink); margin-bottom: 2px; font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-banner-sub   { font-size: 12px; color: var(--color-mw-ink-3); font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-banner-badge { background: var(--color-mw-brand); color: #fff; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: var(--radius-xl); white-space: nowrap; font-family: 'Plus Jakarta Sans', sans-serif; flex-shrink: 0; }

          .sw-section { font-size: 11px; font-weight: 500; color: var(--color-mw-ink-3); letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 12px; font-family: 'Plus Jakarta Sans', sans-serif; }

          .sw-actions-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 28px; }
          .sw-action-card { background: var(--color-mw-surface-card); border: 0.5px solid var(--color-mw-border); border-radius: 10px; padding: 14px 16px; transition: border-color var(--transition-fast); }
          .sw-action-card:hover { border-color: rgba(0,0,0,0.15); }
          .sw-action-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
          .sw-action-name { font-size: 13px; font-weight: 600; color: var(--color-mw-ink); font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-action-pts  { font-size: 13px; font-weight: 700; color: var(--color-mw-brand); white-space: nowrap; font-family: 'DM Mono', monospace; }
          .sw-action-desc { font-size: 12px; color: var(--color-mw-ink-3); line-height: 1.4; font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-action-prog-wrap { margin-top: 10px; }
          .sw-action-prog-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--color-mw-ink-5); margin-bottom: 5px; font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-action-prog-bar  { height: 3px; background: var(--color-mw-border); border-radius: 4px; overflow: hidden; }
          .sw-action-prog-fill { height: 100%; background: var(--color-mw-brand); border-radius: 4px; }

          .sw-routes { display: flex; flex-direction: column; gap: 8px; }
          .sw-route-row { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 0.5px solid rgba(0,0,0,0.09); border-radius: 10px; background: #fff; transition: border-color var(--transition-fast); }
          .sw-route-row:hover { border-color: rgba(0,0,0,0.15); }
          .sw-route-dot   { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff; flex-shrink: 0; }
          .sw-route-info  { flex: 1; min-width: 0; }
          .sw-route-chain  { font-size: 12px; font-weight: 600; color: var(--color-mw-ink); font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-route-tokens { font-size: 12px; color: var(--color-mw-ink-3); font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-route-badge  { font-size: 11px; padding: 3px 8px; border-radius: var(--radius-xl); font-weight: 500; white-space: nowrap; font-family: 'Plus Jakarta Sans', sans-serif; }
          .sw-route-badge.live { background: rgba(34,197,94,0.1); color: var(--color-mw-green); border: 0.5px solid rgba(34,197,94,0.25); }
          .sw-route-badge.soon { background: var(--color-mw-surface-card); color: var(--color-mw-ink-3); border: 0.5px solid var(--color-mw-border); }

          /* ── Right panel ── */
          .sw-right { padding: 28px 24px; }
          .sw-right-inner { position: sticky; top: 28px; }
          .sw-right-label { font-size: 11px; font-weight: 500; color: var(--color-mw-ink-3); letter-spacing: 0.4px; text-transform: uppercase; margin-bottom: 16px; font-family: 'Plus Jakarta Sans', sans-serif; }

          @media (max-width: 900px) {
            .sw-layout { grid-template-columns: 1fr; }
            .sw-left  { border-right: none; border-bottom: 0.5px solid var(--color-mw-border); padding: 24px 20px; }
            .sw-right { padding: 24px 20px; }
            .sw-right-inner { position: static; }
            .sw-actions-grid { grid-template-columns: 1fr; }
          }
        `}</style>

        <div className="sw-layout">
          {/* ── Left: context panel ── */}
          <div className="sw-left">
            <div className="sw-tag"><div className="sw-tag-dot" />Multi-chain · Attribution rewards</div>
            <div className="sw-title">Swap &amp; <span>earn.</span></div>
            <div className="sw-sub">Trade tokens across chains. Every swap builds your Attribution score and unlocks campaign rewards.</div>

            {/* Active campaign banner */}
            {activeCampaign && (
              <div className="sw-banner">
                <div className="sw-banner-icon">⚡</div>
                <div className="sw-banner-body">
                  <div className="sw-banner-title">{activeCampaign.name} campaign active</div>
                  <div className="sw-banner-sub">
                    {actions.slice(0, 2).map(([, a]) => `+${a.points} pts${actionSuffix(a)}`).join(' · ')}
                  </div>
                </div>
                {actions[0] && (
                  <div className="sw-banner-badge">+{actions[0][1].points} pts{actionSuffix(actions[0][1])}</div>
                )}
              </div>
            )}

            {/* Action cards */}
            {actions.length > 0 && (
              <>
                <div className="sw-section">Earn points by action</div>
                <div className="sw-actions-grid">
                  {actions.map(([key, action]) => {
                    const earned  = actionPts(key)
                    const pct     = actionBarPct(key, action)
                    const countLabel = action.one_time
                      ? (earned > 0 ? 'completed' : 'not completed')
                      : action.per_day
                      ? `${earned > 0 ? Math.floor(earned / action.points) : 0} day${Math.floor(earned / action.points) !== 1 ? 's' : ''}`
                      : `${earned > 0 ? Math.floor(earned / action.points) : 0} referral${Math.floor(earned / action.points) !== 1 ? 's' : ''}`
                    return (
                      <div key={key} className="sw-action-card">
                        <div className="sw-action-head">
                          <div className="sw-action-name">{action.label}</div>
                          <div className="sw-action-pts">+{action.points}{actionSuffix(action)}</div>
                        </div>
                        <div className="sw-action-desc">{actionDesc(key, activeCampaign?.name ?? '')}</div>
                        <div className="sw-action-prog-wrap">
                          <div className="sw-action-prog-meta">
                            <span>{countLabel}</span>
                            <span>{earned > 0 ? `${earned} pts earned` : '0 pts earned'}</span>
                          </div>
                          <div className="sw-action-prog-bar">
                            <div className="sw-action-prog-fill" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* Supported routes */}
            <div className="sw-section">Supported routes</div>
            <div className="sw-routes">
              {([
                { dot: '#627eea', char: 'E', from: 'Base',     tokens: 'ETH, USDC, WBTC',         live: true  },
                { dot: '#f7931a', char: 'B', from: 'Ethereum', tokens: 'ETH, USDC, stablecoins',  live: true  },
                { dot: '#9945ff', char: 'S', from: 'Solana',   tokens: 'SOL, USDC',               live: false },
              ] as const).map(r => (
                <div key={r.from} className="sw-route-row" style={!r.live ? { opacity: 0.6 } : undefined}>
                  <div className="sw-route-dot" style={{ background: r.dot }}>{r.char}</div>
                  <div className="sw-route-info">
                    <div className="sw-route-chain">{r.from} → {activeCampaign?.name ?? 'Core DAO'}</div>
                    <div className="sw-route-tokens">{r.tokens}</div>
                  </div>
                  <div className={`sw-route-badge ${r.live ? 'live' : 'soon'}`}>
                    {r.live ? 'Live' : 'Coming soon'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: swap widget ── */}
          <div className="sw-right">
            <div className="sw-right-inner">
              <div className="sw-right-label">Swap tokens</div>
              <Suspense fallback={<SwapSkeleton />}>
                <SwapWidget />
              </Suspense>
            </div>
          </div>
        </div>
      </>
    </MwAuthGuard>
  )
}

function SwapSkeleton() {
  return (
    <div style={{
      background: 'var(--color-mw-surface-card)', borderRadius: 'var(--radius-md)', border: '0.5px solid var(--color-mw-border)',
      height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--color-mw-ink-3)', fontSize: 13, fontFamily: 'Plus Jakarta Sans, sans-serif',
    }}>
      Loading swap…
    </div>
  )
}

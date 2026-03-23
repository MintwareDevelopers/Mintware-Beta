'use client'

import { Suspense, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { MwNav } from '@/components/web2/MwNav'
import { SwapWidget } from '@/components/rewards/swap/SwapWidget'
import { API } from '@/lib/web2/api'

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
  const [swapScore,  setSwapScore]          = useState<number | null>(null)
  const [swapTier,   setSwapTier]           = useState<string | null>(null)

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

  // Fetch attribution score for context panel
  useEffect(() => {
    if (!wallet) return
    fetch(`${API}/score?address=${wallet}`)
      .then(r => r.json())
      .then(d => {
        setSwapScore(d.score ?? 0)
        setSwapTier(d.tier ? d.tier.charAt(0).toUpperCase() + d.tier.slice(1) : null)
      })
      .catch(() => {})
  }, [wallet])

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
      ? action.points * 10
      : action.points * 30
    return Math.min(Math.round((earned / cap) * 100), 100)
  }

  const actions = activeCampaign?.actions ? Object.entries(activeCampaign.actions) : []

  return (
    <MwAuthGuard>
      <MwNav />
      <div className="page-swap bg-mw-bg min-h-screen">
        <div className="max-w-[1160px] mx-auto px-6 py-8 max-[600px]:px-4 max-[600px]:py-6">

          {/* ── Top row: title + attribution ── */}
          <div className="flex items-start justify-between gap-8 mb-8 max-[768px]:flex-col max-[768px]:gap-5">

            {/* Title block */}
            <div>
              <div className="inline-flex items-center gap-[6px] text-[11px] font-semibold text-mw-brand tracking-[0.8px] uppercase mb-[10px] font-sans">
                <div className="w-[6px] h-[6px] rounded-full bg-mw-live" />
                Multi-chain · Attribution rewards
              </div>
              <div className="text-[32px] font-bold tracking-[-0.5px] text-mw-ink mb-[6px] font-sans leading-[1.15]">
                Swap &amp; <span className="text-mw-brand">earn.</span>
              </div>
              <div className="text-[14px] text-mw-ink-3 max-w-[400px] leading-[1.6] font-sans">
                Trade tokens across chains. Every swap builds your Attribution score and unlocks campaign rewards.
              </div>
            </div>

            {/* Attribution score dark card */}
            {wallet && swapScore !== null && (
              <div className="mw-hero-gradient rounded-xl px-6 py-4 flex items-center gap-5 shrink-0 max-[768px]:w-full">
                <div className="shrink-0">
                  <div className="text-[10px] font-bold tracking-[0.1em] uppercase text-mw-ink-3 mb-[5px] font-sans">Your score</div>
                  <div className="text-[42px] font-bold text-mw-brand tracking-[-2px] leading-none font-mono">{swapScore}</div>
                  {swapTier && <div className="text-[11px] text-mw-ink-3 mt-[4px] font-sans">{swapTier} tier</div>}
                </div>
                <div className="w-px bg-[rgba(15,23,42,0.08)] self-stretch shrink-0" />
                <div className="flex-1 text-[13px] text-mw-dark-sub leading-[1.6] font-sans max-w-[200px]">
                  Every swap raises this score permanently. Higher score = larger share of every future campaign pool.
                </div>
              </div>
            )}
          </div>

          {/* ── Main two-column: swap widget (left/primary) + context (right) ── */}
          <div className="grid grid-cols-[minmax(0,520px)_1fr] gap-6 items-start max-[900px]:grid-cols-[1fr]">

            {/* ── Left: Swap widget (hero) ── */}
            <div className="flex flex-col gap-4">

              {/* Active campaign banner */}
              {activeCampaign && (
                <div className="mw-accent-bg bg-white border border-[rgba(79,126,247,0.2)] border-l-[3px] border-l-mw-brand rounded-xl px-5 py-4 flex items-center gap-[14px] shadow-sm">
                  <div className="text-[22px] shrink-0">⚡</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-mw-ink mb-[2px] font-sans">{activeCampaign.name} campaign active</div>
                    <div className="text-[13px] text-mw-ink-3 font-sans">
                      {actions.slice(0, 2).map(([, a]) => `+${a.points} pts${actionSuffix(a)}`).join(' · ')}
                    </div>
                  </div>
                  {actions[0] && (
                    <div className="bg-mw-brand text-white text-[12px] font-bold px-3 py-[6px] rounded-xl whitespace-nowrap font-sans shrink-0">
                      +{actions[0][1].points} pts{actionSuffix(actions[0][1])}
                    </div>
                  )}
                </div>
              )}

              {/* Swap widget elevated card */}
              <div className="mw-accent-bg bg-white rounded-2xl shadow-feature border border-mw-border p-2">
                <Suspense fallback={<SwapSkeleton />}>
                  <SwapWidget />
                </Suspense>
              </div>
            </div>

            {/* ── Right: Context (action cards + routes) ── */}
            <div className="flex flex-col gap-6 max-[900px]:gap-4">

              {/* Action cards */}
              {actions.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-mw-ink-3 tracking-[1.2px] uppercase mb-[14px] font-sans">Earn points by action</div>
                  <div className="flex flex-col gap-[10px]">
                    {actions.map(([key, action]) => {
                      const earned  = actionPts(key)
                      const pct     = actionBarPct(key, action)
                      const countLabel = action.one_time
                        ? (earned > 0 ? 'completed' : 'not completed')
                        : action.per_day
                        ? `${earned > 0 ? Math.floor(earned / action.points) : 0} day${Math.floor(earned / action.points) !== 1 ? 's' : ''}`
                        : `${earned > 0 ? Math.floor(earned / action.points) : 0} referral${Math.floor(earned / action.points) !== 1 ? 's' : ''}`
                      return (
                        <div key={key} className="mw-accent-card bg-white rounded-xl px-4 py-[14px] transition-shadow duration-150 shadow-card hover:shadow-card-hover">
                          <div className="flex items-start justify-between gap-2 mb-[6px]">
                            <div className="text-[14px] font-semibold text-mw-ink font-sans">{action.label}</div>
                            <div className="text-[15px] font-bold text-mw-brand whitespace-nowrap font-mono">+{action.points}{actionSuffix(action)}</div>
                          </div>
                          <div className="text-[13px] text-mw-ink-3 leading-[1.4] font-sans">{actionDesc(key, activeCampaign?.name ?? '')}</div>
                          <div className="mt-[10px]">
                            <div className="flex justify-between text-[11px] text-mw-ink-5 mb-[5px] font-sans">
                              <span>{countLabel}</span>
                              <span>{earned > 0 ? `${earned} pts earned` : '0 pts earned'}</span>
                            </div>
                            <div className="h-[5px] bg-mw-border rounded-full overflow-hidden">
                              <div className="h-full bg-mw-brand rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Supported routes */}
              <div>
                <div className="text-[11px] font-bold text-mw-ink-3 tracking-[1.2px] uppercase mb-[14px] font-sans">Supported routes</div>
                <div className="flex flex-col gap-2">
                  {([
                    { dot: '#627eea', char: 'E', from: 'Base',     tokens: 'ETH, USDC, WBTC',         live: true  },
                    { dot: '#f7931a', char: 'B', from: 'Ethereum', tokens: 'ETH, USDC, stablecoins',  live: true  },
                    { dot: '#9945ff', char: 'S', from: 'Solana',   tokens: 'SOL, USDC',               live: false },
                  ] as const).map(r => (
                    <div key={r.from} className="mw-accent-card flex items-center gap-[10px] px-[14px] py-3 rounded-xl bg-white transition-shadow duration-150 shadow-card hover:shadow-card-hover" style={!r.live ? { opacity: 0.6 } : undefined}>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: r.dot }}>{r.char}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold text-mw-ink font-sans">{r.from} → {activeCampaign?.name ?? 'Core DAO'}</div>
                        <div className="text-[13px] text-mw-ink-3 font-sans">{r.tokens}</div>
                      </div>
                      <div className={`text-[11px] px-2 py-[3px] rounded-xl font-semibold whitespace-nowrap font-sans ${r.live ? 'bg-[rgba(34,197,94,0.1)] text-mw-green border border-[rgba(34,197,94,0.25)]' : 'bg-mw-bg text-mw-ink-3 border border-mw-border'}`}>
                        {r.live ? 'Live' : 'Coming soon'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </MwAuthGuard>
  )
}

function SwapSkeleton() {
  return (
    <div className="bg-mw-surface-card rounded-xl border border-mw-border h-[480px] flex items-center justify-center text-mw-ink-3 text-[13px] font-sans">
      Loading swap…
    </div>
  )
}

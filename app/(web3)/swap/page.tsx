'use client'

import { Suspense, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { MwNav } from '@/components/web2/MwNav'
import { SwapWidget } from '@/components/rewards/swap/SwapWidget'
import { API } from '@/lib/web2/api'

// ─── ATX Settlemint tokens ──────────────────────────────────────────────────────
const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

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
      <div className="page-swap bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
        <div className="max-w-[1160px] mx-auto px-6 py-8 max-[600px]:px-4 max-[600px]:py-6">

          {/* ── Top row: title + attribution ── */}
          <div className="flex items-start justify-between gap-8 mb-8 max-[768px]:flex-col max-[768px]:gap-5">

            {/* Title block */}
            <div>
              <div className="inline-flex items-center gap-[7px] mb-[10px]">
                <span className="w-[9px] h-[9px] bg-atx-acid border border-atx-ink" />
                <span className={LABEL}>Multi-chain · Attribution rewards</span>
              </div>
              <div className="text-[clamp(32px,5vw,52px)] font-bold tracking-[-0.03em] text-atx-ink mb-[8px] leading-[0.9]">
                Swap &amp; <span className="text-atx-blue">earn.</span>
              </div>
              <div className="text-[14px] text-atx-ink/55 max-w-[400px] leading-[1.6]">
                Trade tokens across chains. Every swap builds your Attribution score and unlocks campaign rewards.
              </div>
            </div>

            {/* Attribution score card */}
            {wallet && swapScore !== null && (
              <div className="border border-atx-ink px-6 py-4 flex items-center gap-5 shrink-0 max-[768px]:w-full" style={{ backgroundImage: GRID_BG }}>
                <div className="shrink-0">
                  <div className={`${LABEL} mb-[5px]`}>Your score</div>
                  <div className="text-[42px] font-bold text-atx-blue tracking-[-2px] leading-none font-atx-mono">{swapScore}</div>
                  {swapTier && <div className="text-[11px] text-atx-ink/55 mt-[4px] font-atx-mono uppercase tracking-[0.06em]">{swapTier} tier</div>}
                </div>
                <div className="w-px bg-atx-ink/20 self-stretch shrink-0" />
                <div className="flex-1 text-[13px] text-atx-ink/55 leading-[1.6] max-w-[200px]">
                  Every swap raises this score permanently. Higher score = larger share of every future campaign pool.
                </div>
              </div>
            )}
          </div>

          {/* ── Main two-column: swap widget (left/primary) + context (right) ── */}
          <div className="grid grid-cols-[minmax(0,520px)_1fr] gap-6 items-start max-[900px]:grid-cols-[1fr]">

            {/* ── Left: Swap widget (hero) ── */}
            <div className="flex flex-col gap-4">

              <div className="border border-atx-ink/20 bg-atx-panel px-5 py-4">
                <div className={`${LABEL} mb-[8px]`}>Before you swap</div>
                <div className="flex flex-col gap-[6px] text-[13px] text-atx-ink/60 leading-[1.55]">
                  <div>Review the route and estimated fee on Mintware before your wallet opens.</div>
                  <div>Swaps route on the network you choose in the widget, so check you are on the chain you expect.</div>
                  <div>Keep a small amount of the native token on that chain for the network fee.</div>
                </div>
              </div>

              {/* Active campaign banner */}
              {activeCampaign && (
                <div className="bg-atx-panel border border-atx-ink border-l-[3px] border-l-atx-coral px-5 py-4 flex items-center gap-[14px]">
                  <Star className="w-5 h-5 text-atx-coral shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-atx-ink mb-[2px]">{activeCampaign.name} campaign active</div>
                    <div className="text-[13px] text-atx-ink/55 font-atx-mono">
                      {actions.slice(0, 2).map(([, a]) => `+${a.points} pts${actionSuffix(a)}`).join(' · ')}
                    </div>
                  </div>
                  {actions[0] && (
                    <div className="bg-atx-blue text-white text-[12px] font-bold px-3 py-[6px] border border-atx-ink whitespace-nowrap font-atx-mono shrink-0">
                      +{actions[0][1].points} pts{actionSuffix(actions[0][1])}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-atx-panel border border-atx-ink overflow-hidden">
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
                  <div className={`${LABEL} mb-[14px]`}>Earn points by action</div>
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
                        <div key={key} className="border border-atx-ink/25 bg-atx-panel px-4 py-[14px] transition-colors duration-150 hover:border-atx-ink">
                          <div className="flex items-start justify-between gap-2 mb-[6px]">
                            <div className="text-[14px] font-semibold text-atx-ink">{action.label}</div>
                            <div className="text-[15px] font-bold text-atx-blue whitespace-nowrap font-atx-mono">+{action.points}{actionSuffix(action)}</div>
                          </div>
                          <div className="text-[13px] text-atx-ink/55 leading-[1.4]">{actionDesc(key, activeCampaign?.name ?? '')}</div>
                          <div className="mt-[10px]">
                            <div className="flex justify-between text-[10px] text-atx-ink/45 mb-[5px] font-atx-mono uppercase tracking-[0.06em]">
                              <span>{countLabel}</span>
                              <span>{earned > 0 ? `${earned} pts earned` : '0 pts earned'}</span>
                            </div>
                            <div className="h-[6px] border border-atx-ink overflow-hidden relative">
                              <div className="h-full bg-atx-blue absolute inset-y-0 left-0" style={{ width: `${pct}%` }} />
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
                <div className={`${LABEL} mb-[14px]`}>Supported routes</div>
                <div className="flex flex-col gap-2">
                  {([
                    { dot: '#627eea', char: 'E', from: 'Base',     tokens: 'ETH, USDC, WBTC',         live: true  },
                    { dot: '#f7931a', char: 'B', from: 'Ethereum', tokens: 'ETH, USDC, stablecoins',  live: true  },
                    { dot: '#9945ff', char: 'S', from: 'Solana',   tokens: 'SOL, USDC',               live: false },
                  ] as const).map(r => (
                    <div key={r.from} className="border border-atx-ink/25 flex items-center gap-[10px] px-[14px] py-3 bg-atx-panel transition-colors duration-150 hover:border-atx-ink" style={!r.live ? { opacity: 0.55 } : undefined}>
                      <div className="w-6 h-6 border border-atx-ink flex items-center justify-center text-[11px] font-bold text-white shrink-0 font-atx-mono" style={{ background: r.dot }}>{r.char}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold text-atx-ink">{r.from} → {activeCampaign?.name ?? 'Core DAO'}</div>
                        <div className="text-[12px] text-atx-ink/55 font-atx-mono">{r.tokens}</div>
                      </div>
                      <div className={`text-[10px] px-2 py-[3px] font-semibold whitespace-nowrap font-atx-mono uppercase tracking-[0.06em] border ${r.live ? 'border-atx-ink text-atx-mesquite inline-flex items-center gap-1.5' : 'border-atx-ink/30 text-atx-ink/45'}`}>
                        {r.live && <span className="w-[7px] h-[7px] bg-atx-acid border border-atx-ink inline-block" />}
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
    <div className="bg-atx-panel border border-atx-ink/20 h-[480px] flex items-center justify-center text-atx-ink/55 text-[13px] font-atx-mono uppercase tracking-[0.08em]">
      Loading swap…
    </div>
  )
}

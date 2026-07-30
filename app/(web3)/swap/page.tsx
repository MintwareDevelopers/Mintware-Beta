'use client'

// =============================================================================
// /swap — promoted from the /style/swap concept (2026-07-29).
//
// Faithful port of the editorial "two-surface reputation entry point" concept
// onto the REAL data + money-path:
//   • The trade core is the real <SwapWidget/> (LI.FI fee-injection). Untouched.
//   • Editorial hero + reputation stat band wired to the live /score API.
//   • "Suggested · where the points are" strip = REAL live campaigns; one tap
//     sets the campaign context (sessionStorage mw_campaign_id, exactly like
//     SwapModal) and remounts the widget with the campaign's token preselected.
//   • Earn-by-action detail (real participant progress) is preserved, not dropped.
//   • RWA is represented honestly — the second surface links to the real /vaults
//     product. We do NOT fabricate RWA deals/NAV on the production money-path page
//     (the RWA incentive layer is not live in prod).
// =============================================================================

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { MwNav } from '@/components/web2/MwNav'
import { SwapWidget } from '@/components/rewards/swap/SwapWidget'
import { API } from '@/lib/web2/api'

// ─── ATX Settlemint tokens ──────────────────────────────────────────────────────
const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const LINE = 'border-atx-ink/20'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────
type ActionValue = {
  label: string
  points: number
  per_day?: boolean
  per_referral?: boolean
  per_referred_trade?: boolean
  one_time?: boolean
}
interface Campaign {
  id: string
  name: string
  chain?: string
  chain_id?: number
  status: string
  token_contract?: string
  token_symbol?: string
  actions?: Record<string, ActionValue>
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

// Resolve a campaign's numeric chain id the same way CampaignCard does.
const CHAIN_NAME_TO_ID: Record<string, number> = {
  base: 8453, arbitrum: 42161, ethereum: 1, eth: 1, mainnet: 1,
  bsc: 56, bnb: 56, polygon: 137, optimism: 10, coredao: 1116, core: 1116,
}
const chainIdOf = (c: Campaign) => c.chain_id ?? CHAIN_NAME_TO_ID[c.chain?.toLowerCase() ?? ''] ?? 0

// ─── Helpers ──────────────────────────────────────────────────────────────────
function actionSuffix(a: ActionValue): string {
  if (a.per_day)            return '/day'
  if (a.per_referral)       return '/ref'
  if (a.per_referred_trade) return '/trade'
  return ''
}
function actionDesc(key: string, campaignName: string): string {
  if (key === 'trade')                                      return `Swap any token on ${campaignName} to earn daily points`
  if (key === 'bridge')                                     return `Bridge from Base or Ethereum to ${campaignName} for bonus points`
  if (key.startsWith('referral') && key.includes('trade'))  return `Earn points for every wallet that trades via your invite link`
  if (key.startsWith('referral'))                          return `One-time bonus when a referred wallet completes a full trade`
  return `Complete this action on ${campaignName}`
}
// Attribution reward multiplier for points campaigns — documented table (rewards.md).
function multForPct(pct: number | null): number | null {
  if (pct === null) return null
  return pct >= 67 ? 1.5 : pct >= 34 ? 1.25 : 1.0
}

// ─── Swap Page ─────────────────────────────────────────────────────────────────
function SwapContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const router = useRouter()
  const searchParams = useSearchParams()

  const [campaigns, setCampaigns]       = useState<Campaign[]>([])
  const [participant, setParticipant]   = useState<Participant | null>(null)
  const [swapScore, setSwapScore]       = useState<number | null>(null)
  const [swapTier,  setSwapTier]        = useState<string | null>(null)
  const [swapPct,   setSwapPct]         = useState<number | null>(null)

  // ── The URL's ?cid= is the SINGLE source of truth for the active/credited
  //    campaign. SwapWidget's useCampaign() reads ?cid= first, so driving
  //    selection through the URL guarantees the credited campaign always equals
  //    the visibly-active one (no sessionStorage write-timing race vs the widget
  //    remount). We never write mw_campaign_id ourselves — useCampaign owns it. ──
  const urlCid = searchParams.get('cid')
  const activeId = urlCid && campaigns.some(c => c.id === urlCid) ? urlCid : null

  // Live campaigns
  useEffect(() => {
    fetch(`${API}/campaigns`)
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return
        setCampaigns((data as Campaign[]).filter(c => c.status === 'live'))
      })
      .catch(() => {})
  }, [])

  // Once campaigns load, ensure a valid ?cid= is present — default to the first
  // live campaign — so the displayed/preselected campaign is also the credited
  // one. Runs once; explicit taps thereafter set ?cid= directly.
  const didSeed = useRef(false)
  useEffect(() => {
    if (didSeed.current || !campaigns.length) return
    if (activeId) { didSeed.current = true; return }  // URL already carries a live cid
    const first = campaigns[0]?.id
    if (!first) return
    didSeed.current = true
    const p = new URLSearchParams(Array.from(searchParams.entries()))
    p.set('cid', first)
    router.replace(`/swap?${p.toString()}`, { scroll: false })
  }, [campaigns, activeId, router, searchParams])

  // Attribution score for the reputation rail
  useEffect(() => {
    if (!wallet) { setSwapScore(null); setSwapTier(null); setSwapPct(null); return }
    fetch(`${API}/score?address=${wallet}`)
      .then(r => r.json())
      .then(d => {
        setSwapScore(d.score ?? 0)
        setSwapTier(d.tier ? d.tier.charAt(0).toUpperCase() + d.tier.slice(1) : null)
        setSwapPct(typeof d.percentile === 'number' ? d.percentile : null)
      })
      .catch(() => {})
  }, [wallet])

  const activeCampaign = useMemo(() => campaigns.find(c => c.id === activeId) ?? null, [campaigns, activeId])

  // Participant data for the active campaign
  useEffect(() => {
    if (!activeCampaign || !wallet) { setParticipant(null); return }
    fetch(`${API}/campaign?id=${encodeURIComponent(activeCampaign.id)}&address=${wallet}`)
      .then(r => r.json())
      .then((d: { participant?: Participant }) => setParticipant(d.participant ?? null))
      .catch(() => setParticipant(null))
  }, [activeCampaign, wallet])

  // Selecting a suggested campaign = navigate to its ?cid=. useCampaign (URL-first,
  // reactive to searchParams) then credits it; the widget remounts (key) so its
  // token preselect re-applies. Displayed and credited stay in lockstep.
  function selectCampaign(c: Campaign) {
    const p = new URLSearchParams(Array.from(searchParams.entries()))
    p.set('cid', c.id)
    router.replace(`/swap?${p.toString()}`, { scroll: false })
  }

  // Preselect for the active campaign (only when it has a tradable token).
  const preselect = useMemo(() => {
    if (!activeCampaign?.token_contract) return null
    const cid = chainIdOf(activeCampaign)
    if (!cid) return null
    return { address: activeCampaign.token_contract, chainId: cid, symbol: activeCampaign.token_symbol }
  }, [activeCampaign])

  function actionPts(key: string): number {
    const field = ACTION_FIELD_MAP[key]
    return field ? (participant?.[field] ?? 0) : 0
  }
  function actionBarPct(key: string, action: ActionValue): number {
    const earned = actionPts(key)
    if (earned === 0) return 0
    if (action.one_time) return 100
    const cap = action.per_referral || action.per_referred_trade ? action.points * 10 : action.points * 30
    return Math.min(Math.round((earned / cap) * 100), 100)
  }

  const actions = activeCampaign?.actions ? Object.entries(activeCampaign.actions) : []
  const mult = multForPct(swapPct)
  // Campaigns that can be one-tap loaded into the widget (have a tradable token).
  const suggested = campaigns.filter(c => c.token_contract && chainIdOf(c))

  return (
    <div className="page-swap bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">

        {/* ── Editorial hero ── */}
        <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
          <div className="px-7 pt-8 pb-7 max-[600px]:px-4">
            <p className={`${LABEL} mb-4`}>On-chain reputation · rewards · 100+ chains</p>
            <h1 className="font-bold tracking-[-0.03em] leading-[0.85] text-[clamp(40px,8vw,88px)]">
              TRADE LIKE IT <span className="text-atx-blue">COUNTS.</span>
            </h1>
            <p className="text-atx-ink/60 text-[15px] max-w-[64ch] mt-4">
              Every swap builds your Attribution score and earns rewards weighted by who you are.
              Trade tokens across chains here — real-world yield lives on the RWA surface. One reputation
              carries both.
            </p>
          </div>
          <div className="border-t border-atx-ink grid [grid-template-columns:1.4fr_1fr_1fr_1fr] max-[720px]:[grid-template-columns:1fr_1fr]">
            {[
              {
                l: 'Your score',
                v: wallet ? (swapScore !== null ? <span key="s" className="text-atx-blue">{swapScore}</span> : '…') : '—',
                sub: wallet ? (swapTier ?? 'attribution') : 'connect wallet',
              },
              {
                l: 'Reward multiplier',
                v: mult !== null ? `${mult.toFixed(2)}×` : '—',
                sub: swapPct !== null ? `percentile ${swapPct}` : 'points campaigns',
              },
              {
                l: 'Live campaigns',
                v: String(campaigns.length).padStart(2, '0'),
                sub: campaigns.length ? 'earning now' : 'none active',
              },
              { l: 'Routing', v: 'Aggregated', sub: '0x · Molten · LI.FI' },
            ].map((s, i) => (
              <div key={i} className={`px-7 py-3 max-[600px]:px-4 ${i < 3 ? 'border-r border-atx-ink/20' : ''}`}>
                <div className={`${LABEL} text-[9px] mb-1.5`}>{s.l}</div>
                <div className="font-bold text-[15px] tabular-nums">{s.v}</div>
                <div className="font-atx-mono text-[10px] text-atx-ink/45 mt-0.5 truncate">{s.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Widget (left) + suggested campaigns (right) ── */}
        <div className="px-7 py-8 grid [grid-template-columns:minmax(0,1.3fr)_1fr] gap-[22px] items-start max-[900px]:grid-cols-1 max-[600px]:px-4 max-[600px]:py-6">

          {/* ── Left: trade core + earn context ── */}
          <div className="flex flex-col gap-4">

            {/* Active campaign banner */}
            {activeCampaign && (
              <div className="bg-atx-panel border border-atx-ink border-l-[3px] border-l-atx-coral px-5 py-4 flex items-center gap-[14px]">
                <Star className="w-5 h-5 text-atx-coral shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-atx-ink mb-[2px] truncate">{activeCampaign.name} campaign active</div>
                  <div className="text-[13px] text-atx-ink/55 font-atx-mono truncate">
                    {actions.slice(0, 2).map(([, a]) => `+${a.points} pts${actionSuffix(a)}`).join(' · ') || 'Swap to earn Attribution'}
                  </div>
                </div>
                {actions[0] && (
                  <div className="bg-atx-blue text-white text-[12px] font-bold px-3 py-[6px] border border-atx-ink whitespace-nowrap font-atx-mono shrink-0">
                    +{actions[0][1].points} pts{actionSuffix(actions[0][1])}
                  </div>
                )}
              </div>
            )}

            {/* Compact pre-swap guidance — review the route/fee before the wallet
                opens, mind the chain, keep native token for gas. */}
            <div className="border border-atx-ink/20 bg-atx-panel px-4 py-3 font-atx-mono text-[11px] text-atx-ink/55 leading-[1.6]">
              Review the route and fee before confirming · check you’re on the expected chain · keep some native token for the network fee.
            </div>

            {/* The real swap widget — money-path. Remounts (key) when the
                selected campaign changes so its token preselect applies. */}
            <div className="bg-atx-panel border border-atx-ink overflow-hidden">
              <Suspense fallback={<SwapSkeleton />}>
                <SwapWidget
                  key={activeCampaign?.id ?? 'default'}
                  preselectBuy={preselect ?? undefined}
                  preselectChainId={preselect?.chainId}
                />
              </Suspense>
            </div>

            {/* Earn-by-action detail — real participant progress (preserved) */}
            {actions.length > 0 && (
              <div>
                <div className={`${LABEL} mb-[14px]`}>What you earn on {activeCampaign?.name}</div>
                <div className="flex flex-col gap-[10px]">
                  {actions.map(([key, action]) => {
                    const earned = actionPts(key)
                    const pct    = actionBarPct(key, action)
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
          </div>

          {/* ── Right: suggested campaign swaps (tap to load) + RWA surface ── */}
          <aside className="flex flex-col gap-6 max-[900px]:gap-5">

            {/* Suggested · where the points are */}
            <div>
              <div className="flex items-baseline gap-3 mb-3">
                <span className={LABEL}>Suggested · where the points are</span>
                {suggested.length > 0 && <span className="ml-auto font-atx-mono text-[11px] text-atx-ink/40 max-[900px]:hidden">tap to load ←</span>}
              </div>
              {suggested.length > 0 ? (
                <div className="flex flex-col border border-atx-ink">
                  {suggested.map(c => {
                    const on = c.id === activeId
                    const firstAction = c.actions ? Object.values(c.actions)[0] : undefined
                    const reward = firstAction ? `+${firstAction.points} pts${actionSuffix(firstAction)}` : 'earn pts'
                    return (
                      <button
                        key={c.id}
                        onClick={() => selectCampaign(c)}
                        className={`text-left p-[13px_15px] border-b border-atx-ink/20 last:border-b-0 flex items-center gap-3 transition-colors ${
                          on ? 'bg-atx-blue/[0.08] border-l-2 border-l-atx-blue' : 'bg-atx-bone hover:bg-atx-ink/[0.04]'
                        }`}
                      >
                        <Star className="w-4 h-4 shrink-0 text-atx-blue" />
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-[14px] tracking-tight truncate">Trade → {c.token_symbol ?? c.name}</div>
                          <div className="font-atx-mono text-[11px] mt-0.5 truncate text-atx-ink/50">{c.chain ?? 'multi-chain'} · {c.name}</div>
                        </div>
                        {on ? (
                          <span className="shrink-0 font-atx-mono text-[9px] uppercase tracking-[0.1em] text-atx-blue">loaded</span>
                        ) : (
                          <span className="shrink-0 font-atx-mono text-[9px] uppercase tracking-[0.04em] px-1.5 py-1 border leading-tight border-atx-blue text-atx-blue">{reward}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="border border-atx-ink/25 bg-atx-panel px-4 py-5 font-atx-mono text-[12px] text-atx-ink/55 leading-[1.5]">
                  No token campaigns live right now. Any swap still builds your Attribution score.
                </div>
              )}
            </div>

            {/* RWA surface — the honest second surface (real product, not a mock) */}
            <div>
              <div className={`${LABEL} mb-3`}>The other surface</div>
              <Link
                href="/vaults"
                className="block border border-atx-ink border-l-[3px] border-l-atx-coral bg-atx-panel px-5 py-4 transition-colors hover:bg-atx-coral/[0.06]"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Star className="w-4 h-4 text-atx-coral" />
                  <span className="font-bold text-[15px] tracking-tight">Real-world yield</span>
                  <span className="ml-auto font-atx-mono text-[16px] text-atx-coral">→</span>
                </div>
                <p className="text-[13px] text-atx-ink/55 leading-[1.5]">
                  SPV-wrapped real-world assets — T-bills, trade finance, carbon — subscribed at NAV.
                  Your reputation carries across. Explore the RWA vaults surface.
                </p>
              </Link>
            </div>

            <div className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-ink/40 flex items-center gap-1.5 px-1">
              <Star className="w-3 h-3" /> Powered by Attribution
            </div>
          </aside>
        </div>
      </div>
  )
}

export default function SwapPage() {
  return (
    <MwAuthGuard>
      <MwNav />
      <Suspense fallback={<PageFallback />}>
        <SwapContent />
      </Suspense>
    </MwAuthGuard>
  )
}

function PageFallback() {
  return (
    <div className="page-swap bg-atx-bone min-h-screen font-atx-display text-atx-ink flex items-center justify-center text-atx-ink/55 text-[13px] font-atx-mono uppercase tracking-[0.08em]">
      Loading swap…
    </div>
  )
}

function SwapSkeleton() {
  return (
    <div className="bg-atx-panel border border-atx-ink/20 h-[480px] flex items-center justify-center text-atx-ink/55 text-[13px] font-atx-mono uppercase tracking-[0.08em]">
      Loading swap…
    </div>
  )
}

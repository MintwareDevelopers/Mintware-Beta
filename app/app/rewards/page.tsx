'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { useEffect, useState, useCallback, Suspense, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { API, scoreApiUrl, fmtUSD, daysUntil } from '@/lib/web2/api'
import { AnimatedScore } from '@/components/web2/AnimatedScore'
import { Campaign } from '@/components/rewards/campaigns/CampaignCard'
import { TokenIcon } from '@/components/web2/TokenIcon'

const CAMP_ORDER: Record<string, number> = { live: 0, upcoming: 1, ended: 2 }
const CAMP_STATUS: Record<string, { label: string; cls: string; live: boolean }> = {
  live:     { label: 'Live',     cls: 'text-atx-mesquite border-atx-mesquite', live: true },
  upcoming: { label: 'Upcoming', cls: 'text-atx-clay border-atx-clay', live: false },
  ended:    { label: 'Ended',    cls: 'text-atx-ink/45 border-atx-ink/25', live: false },
}

// ─── ATX Settlemint tokens ──────────────────────────────────────────────────────
const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const EY = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-grey flex items-center gap-2.5'
const H2 = 'font-bold tracking-[-0.02em] leading-[1.03] text-[clamp(25px,3.5vw,42px)] mt-3.5 max-w-[22ch] text-wrap-balance'
const LEAD = 'text-[16px] leading-[1.55] text-atx-ink/70 max-w-[60ch] mt-4'
const BTN = 'font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3 border border-atx-ink bg-atx-bone text-atx-ink no-underline inline-block cursor-pointer'
const BTN_ACC = 'font-atx-mono text-[12px] uppercase tracking-[0.08em] px-5 py-3 border border-atx-blue bg-atx-blue text-white no-underline inline-block cursor-pointer'

// ─── Rewards Content ────────────────────────────────────────────────────────────
function RewardsContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const searchParams = useSearchParams()

  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([])
  const [activeTab, setActiveTab] = useState<'explore' | 'mine'>('explore')
  const [currentFilter, setCurrentFilter] = useState('All')
  const [surface, setSurface] = useState<'all' | 'defi'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [userScore, setUserScore]           = useState<number | null>(null)
  const [userTier, setUserTier]             = useState<string | null>(null)
  const [userPercentile, setUserPercentile] = useState<number | null>(null)
  const [myCampaignIds, setMyCampaignIds]   = useState<Set<string>>(new Set())
  const [mineLoading, setMineLoading]       = useState(false)

  // Track referrer from URL
  useEffect(() => {
    const ref = searchParams.get('ref') || searchParams.get('r')
    if (ref) sessionStorage.setItem('mw_pending_ref', ref)
  }, [searchParams])

  // Load Attribution score, tier, percentile
  useEffect(() => {
    if (!wallet) return
    fetch(scoreApiUrl(wallet))
      .then(r => r.json())
      .then(d => {
        setUserScore(d.score ?? 0)
        setUserTier(d.tier ? d.tier.charAt(0).toUpperCase() + d.tier.slice(1) : null)
        setUserPercentile(d.percentile ?? null)
      })
      .catch(() => {})
  }, [wallet])

  // Load campaigns
  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`${API}/campaigns`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('Unexpected response')
      setAllCampaigns(data)
    } catch {
      setError('Could not load campaigns. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])

  // Load "My Campaigns" membership when that tab is selected
  useEffect(() => {
    if (activeTab !== 'mine' || !wallet || allCampaigns.length === 0) return
    setMineLoading(true)
    Promise.all(
      allCampaigns.map(c =>
        fetch(`${API}/campaign?id=${encodeURIComponent(c.id)}&address=${wallet}`)
          .then(r => r.json())
          .then((d: { participant?: unknown }) => (d.participant ? c.id : null))
          .catch(() => null)
      )
    ).then(results => {
      setMyCampaignIds(new Set(results.filter(Boolean) as string[]))
    }).finally(() => setMineLoading(false))
  }, [activeTab, wallet, allCampaigns])

  // Derived stats
  const liveCampaigns   = allCampaigns.filter(c => c.status === 'live')
  const upcomingCampaigns = allCampaigns.filter(c => c.status === 'upcoming')
  const totalPool   = liveCampaigns.reduce((s, c) => s + (c.pool_usd ?? 0), 0)
  const totalDaily  = liveCampaigns.reduce((s, c) => s + (c.daily_payout_usd ?? 0), 0)
  const minScore    = liveCampaigns[0]?.min_score ?? null
  const liveCount   = liveCampaigns.length
  const upcomingCount = upcomingCampaigns.length

  const filterDefs = [
    { key: 'All',      count: null as number | null },
    { key: 'Live',     count: liveCount > 0 ? liveCount : null },
    { key: 'Upcoming', count: upcomingCount > 0 ? upcomingCount : null },
    { key: 'Ended',    count: null as number | null },
  ]

  function getFiltered() {
    let base = activeTab === 'mine' ? allCampaigns.filter(c => myCampaignIds.has(c.id)) : allCampaigns
    if (surface !== 'all') base = base.filter(c => (c.surface ?? 'defi') === surface)
    if (currentFilter === 'Live')     return base.filter(c => c.status === 'live')
    if (currentFilter === 'Upcoming') return base.filter(c => c.status === 'upcoming')
    if (currentFilter === 'Ended')    return base.filter(c => c.status === 'ended')
    return base
  }

  const filtered         = getFiltered()
  const filteredLive     = filtered.filter(c => c.status === 'live')
  const filteredUpcoming = filtered.filter(c => c.status === 'upcoming')
  const filteredEnded    = filtered.filter(c => c.status === 'ended')

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">

      <>
          {/* ── Users hero ── */}
          <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
            <div className="max-w-[1100px] mx-auto px-7 grid grid-cols-[1.5fr_1fr] max-[820px]:grid-cols-1 max-[800px]:px-4">
              <div className="py-11 pr-9 max-[820px]:pr-0">
                <div className={EY}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-acid" />Rewards · Reputation-weighted</div>
                <h1 className="font-bold tracking-[-0.02em] leading-[0.99] text-[clamp(32px,4.6vw,54px)] mt-5 max-w-[17ch] text-wrap-balance">
                  Contribution that is <span className="text-atx-blue">seen and rewarded</span>
                </h1>
                <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-atx-ink/70 max-w-[54ch] mt-5">
                  Every swap, liquidity position, lock, and referral earns points — and in <b className="text-atx-ink">score-multiplied campaigns</b>, your Attribution score lifts them up to 1.95×. Come get paid for the history you&apos;ve already built.
                </p>
                <div className="flex gap-2.5 mt-7 flex-wrap">
                  <a href="#campaigns" className={BTN_ACC}>Browse campaigns ↓</a>
                  <Link href="/app/profile" className={BTN}>See your score</Link>
                </div>
              </div>

              <div className="border-l border-atx-ink/20 pl-10 py-10 flex flex-col justify-center max-[820px]:border-l-0 max-[820px]:border-t max-[820px]:border-atx-ink/20 max-[820px]:pl-0 max-[820px]:pt-8">
                <div className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-grey flex items-center gap-2">
                  <span className="w-[9px] h-[9px] bg-atx-acid border border-atx-ink" />Your Attribution
                </div>
                {wallet ? (
                  <>
                    <div className="text-[60px] font-bold text-atx-blue tracking-[-3px] leading-none font-atx-mono mt-4">
                      {userScore !== null
                        ? <><AnimatedScore value={userScore} /><span className="text-[19px] font-medium text-atx-ink/30 ml-2 tracking-normal">pts</span></>
                        : <span className="text-atx-ink/20">—</span>}
                    </div>
                    {userTier && (
                      <div className="inline-flex items-center gap-2 border border-atx-ink bg-atx-panel px-3 py-1 mt-3.5 w-fit">
                        <span className="text-[12px] font-semibold text-atx-blue font-atx-mono uppercase tracking-[0.04em]">{userTier} tier</span>
                        {userPercentile !== null && <span className="text-[11px] text-atx-grey font-atx-mono">· top {100 - userPercentile}%</span>}
                      </div>
                    )}
                    <div className="text-[13px] text-atx-ink/55 leading-relaxed max-w-[26ch] mt-3.5">
                      In score-multiplied campaigns, your Attribution score lifts your points — up to 1.95×.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[52px] font-bold text-atx-ink/15 tracking-[-3px] leading-none font-atx-mono mt-4 mb-1">?</div>
                    <div className="text-[15px] font-semibold text-atx-ink mb-2 leading-snug mt-2">Your score is waiting.</div>
                    <div className="text-[13px] text-atx-ink/55 leading-relaxed max-w-[24ch]">
                      Connect your wallet to see your Attribution score and unlock campaign rewards.
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ── Campaigns — the main event, straight after the hero ── */}
          <div id="campaigns" className="px-7 pb-12 pt-8 max-w-[1100px] mx-auto max-[800px]:px-4">
            {error && (
              <div className="border border-atx-clay text-atx-clay px-3.5 py-2.5 text-[13px] mb-4 font-atx-mono">{error}</div>
            )}

            {/* Tabs */}
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div className="flex gap-0 border border-atx-ink w-fit">
                <button
                  className={`py-2 px-4 text-[12px] cursor-pointer font-atx-mono uppercase tracking-[0.06em] transition-colors duration-150 ${activeTab === 'explore' ? 'bg-atx-blue text-white font-semibold' : 'bg-transparent text-atx-ink/60 hover:text-atx-ink'}`}
                  onClick={() => setActiveTab('explore')}
                >Explore</button>
                <button
                  className={`py-2 px-4 text-[12px] cursor-pointer font-atx-mono uppercase tracking-[0.06em] border-l border-atx-ink transition-colors duration-150 ${activeTab === 'mine' ? 'bg-atx-blue text-white font-semibold' : 'bg-transparent text-atx-ink/60 hover:text-atx-ink'}`}
                  onClick={() => setActiveTab('mine')}
                >My Campaigns</button>
              </div>
              <Link
                href="/app/create-campaign"
                className="inline-flex items-center gap-1.5 bg-atx-blue text-white text-[12px] font-semibold font-atx-mono uppercase tracking-[0.05em] py-2 px-4 border border-atx-ink no-underline shrink-0 transition-opacity duration-150 hover:opacity-90"
              >
                + Create campaign
              </Link>
            </div>

            {/* Filters + surface select */}
            <div className="flex gap-3 mb-5 items-center flex-wrap justify-between">
              <div className="flex gap-2 items-center flex-wrap">
                {filterDefs.map(f => (
                  <button
                    key={f.key}
                    className={`text-[12px] font-medium font-atx-mono uppercase tracking-[0.06em] py-1.5 px-4 cursor-pointer inline-flex items-center gap-1.5 border transition-colors duration-150 ${
                      currentFilter === f.key
                        ? 'border-atx-ink bg-atx-blue text-white'
                        : 'border-atx-ink/30 text-atx-ink/60 hover:border-atx-ink hover:text-atx-ink'
                    }`}
                    onClick={() => setCurrentFilter(f.key)}
                  >
                    {f.key}
                    {f.count !== null && (
                      <span className={`inline-flex items-center justify-center min-w-4 h-4 px-1 border text-[10px] font-semibold ${currentFilter === f.key ? 'border-white text-white' : 'border-atx-ink text-atx-ink'}`}>
                        {f.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="inline-flex border border-atx-ink shrink-0">
                {(['all', 'defi'] as const).map((s, i) => (
                  <button
                    key={s}
                    onClick={() => setSurface(s)}
                    className={`font-atx-mono text-[11px] uppercase tracking-[0.08em] px-3.5 py-1.5 cursor-pointer ${i > 0 ? 'border-l border-atx-ink' : ''} ${surface === s ? 'bg-atx-blue text-white' : 'bg-transparent text-atx-ink/55 hover:text-atx-ink'}`}
                  >
                    {s === 'all' ? 'All' : 'DeFi'}
                  </button>
                ))}
              </div>
            </div>

            {(loading || mineLoading) ? (
              <div className="grid grid-cols-2 gap-4 max-[800px]:grid-cols-1">
                <div className="border border-atx-ink/20 bg-atx-panel p-5 min-h-[160px]" />
                <div className="border border-atx-ink/20 bg-atx-panel p-5 min-h-[160px]" />
              </div>
            ) : activeTab === 'mine' && !wallet ? (
              <div className="text-center py-12 px-5 text-atx-ink/55 text-[14px] font-atx-mono">
                Connect your wallet to see your campaigns.
              </div>
            ) : activeTab === 'mine' && filtered.length === 0 ? (
              <div className="text-center py-12 px-5 text-atx-ink/55 text-[14px] font-atx-mono">
                You haven&apos;t joined any campaigns yet.{' '}
                <span className="text-atx-blue cursor-pointer" onClick={() => setActiveTab('explore')}>Browse campaigns →</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 px-5 text-atx-ink/55 text-[14px] font-atx-mono">
                No campaigns match this filter.
              </div>
            ) : (
              <>
                {/* Campaigns — dense database-style table */}
                <div className="border border-atx-ink bg-atx-bone overflow-x-auto mb-6">
                  <table className="w-full border-collapse text-[13px] min-w-[880px]">
                    <thead>
                      <tr className="border-b border-atx-ink bg-atx-panel">
                        {([['Campaign', 'l'], ['Status', 'l'], ['Reward pool', 'r'], ['Daily', 'r'], ['Min score', 'r'], ['Top reward', 'r'], ['Ends', 'r'], ['', 'r']] as const).map(([h, al], i) => (
                          <th key={i} className={`font-atx-mono text-[9.5px] uppercase tracking-[0.09em] text-atx-ink/55 px-4 py-3 whitespace-nowrap ${al === 'r' ? 'text-right' : 'text-left'} ${(i === 3 || i === 4) ? 'max-[900px]:hidden' : ''} ${i === 5 ? 'max-[760px]:hidden' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...filtered].sort((a, b) => (CAMP_ORDER[a.status] ?? 3) - (CAMP_ORDER[b.status] ?? 3)).map(c => {
                        const st = CAMP_STATUS[c.status] ?? CAMP_STATUS.ended
                        const firstAction = c.actions ? Object.values(c.actions)[0] : undefined
                        const reward = firstAction ? `+${firstAction.points}${firstAction.per_day ? '/day' : firstAction.per_referral ? '/ref' : ''}` : '—'
                        const endsDays = c.status === 'upcoming' ? (c.start_date ? daysUntil(c.start_date) : null) : (c.end_date ? daysUntil(c.end_date) : null)
                        const endsTxt = c.status === 'ended' ? 'ended' : endsDays != null ? `${c.status === 'upcoming' ? 'in ' : ''}${endsDays}d` : 'live'
                        return (
                          <tr key={c.id} className="border-b border-atx-ink/15 last:border-b-0 hover:bg-atx-panel/60 transition-colors">
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-3 min-w-0">
                                <TokenIcon tokenAddress={c.token_contract} chain={c.chain_id ?? c.chain} name={c.protocol ?? c.name} size={32} borderRadius={0} />
                                <div className="min-w-0">
                                  <div className="font-bold text-[14px] tracking-tight truncate">{c.name}</div>
                                  <div className="font-atx-mono text-[11px] text-atx-ink/45 truncate">{c.protocol ? `${c.protocol} · ` : ''}{c.chain}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`inline-flex items-center gap-1.5 font-atx-mono text-[10px] uppercase tracking-[0.06em] border px-2 py-1 ${st.cls}`}>
                                {st.live && <span className="w-[6px] h-[6px] bg-atx-acid inline-block animate-pulse" />}{st.label}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right font-atx-mono tabular-nums">{c.pool_usd != null ? fmtUSD(c.pool_usd) : '—'}</td>
                            <td className="px-4 py-3.5 text-right font-atx-mono tabular-nums text-atx-coral max-[900px]:hidden">{c.daily_payout_usd != null ? fmtUSD(c.daily_payout_usd) : '—'}</td>
                            <td className="px-4 py-3.5 text-right font-atx-mono tabular-nums text-atx-ink/60 max-[900px]:hidden">{c.min_score != null ? c.min_score : '—'}</td>
                            <td className="px-4 py-3.5 text-right font-atx-mono tabular-nums text-atx-blue font-bold max-[760px]:hidden">{reward}</td>
                            <td className={`px-4 py-3.5 text-right font-atx-mono tabular-nums ${c.status === 'ended' ? 'text-atx-ink/40' : endsDays != null && endsDays <= 3 ? 'text-atx-clay font-semibold' : 'text-atx-ink/70'}`}>{endsTxt}</td>
                            <td className="px-4 py-3.5 text-right">
                              <Link href={`/campaign/${c.id}`} className="inline-flex font-atx-mono text-[10.5px] uppercase tracking-[0.06em] border border-atx-ink px-3 py-1.5 no-underline text-atx-ink hover:bg-atx-ink hover:text-atx-bone transition-colors whitespace-nowrap">View →</Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Recent activity */}
                <div className="mt-7">
                  <div className={`${LABEL} mb-3.5`}>Recent activity</div>
                  <div className="flex flex-col gap-1.5">
                    {wallet ? (
                      <div className="border border-atx-ink/20 bg-atx-panel px-4 py-8 text-center text-atx-ink/55 text-[13px] font-atx-mono">No activity yet — join a campaign and start trading to see your history here.</div>
                    ) : (
                      <div className="border border-atx-ink/20 bg-atx-panel px-4 py-8 text-center text-atx-ink/55 text-[13px] font-atx-mono">Connect your wallet to see recent activity.</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── How earning works — the "why", below the campaigns ── */}
          <section className="border-t border-atx-ink">
            <div className="max-w-[1100px] mx-auto px-7 py-[52px] max-[800px]:px-4 mw-reveal">
              <div className={EY}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-acid" />Every action, rewarded</div>
              <h2 className={H2}>Four ways to earn. <span className="text-atx-blue">One multiplier.</span></h2>
              <p className={LEAD}>Every action is scored, then multiplied by your reputation.</p>
              <div className="grid grid-cols-4 border border-atx-ink mt-7 max-[800px]:grid-cols-1">
                {[
                  ['Trade', 'DeFi', false, 'Swap on any pool — best-execution routing, and every trade builds your Attribution score and earns rewards weighted by who you are.', '+8 pts / trade'],
                  ['Provide liquidity', 'DeFi · soon', true, 'Reputation-weighted liquidity vaults are in testing — the sticky capital a pool actually needs. When they launch, your fee share will be lifted by your Attribution score.', 'fee share × reputation'],
                  ['Lock', 'DeFi · soon', true, 'Commit your LP to a lock tier — longer commitment, higher multiplier. In testing: a weekly snapshot will credit you by balance × duration × reputation.', 'rate × held × duration'],
                  ['Refer', 'DeFi', false, 'Bring qualified LPs and traders — relationship-sourced distribution, the referral that sources a real relationship, not a bot.', '+60 pts / referral'],
                ].map(([name, badge, hot, desc, pts], i) => (
                  <div key={name as string} className={`p-5 ${i < 3 ? 'border-r border-atx-ink max-[800px]:border-r-0 max-[800px]:border-b' : ''}`}>
                    <div className="text-[19px] font-bold flex items-center gap-2 flex-wrap">
                      {name}
                      <span className={`font-atx-mono text-[9px] uppercase tracking-[0.1em] border border-atx-ink px-1.5 py-0.5 ${hot ? 'bg-atx-coral' : 'bg-atx-acid'}`}>{badge}</span>
                    </div>
                    <div className="text-[13px] text-atx-ink/70 leading-[1.45] mt-2.5 min-h-[82px]">{desc}</div>
                    <div className="font-atx-mono text-[13px] text-atx-blue font-bold mt-2 border-t border-atx-ink/10 pt-2.5">{pts}</div>
                  </div>
                ))}
              </div>
              <div className="font-atx-mono text-[13px] text-atx-mesquite mt-4.5">
                <b className="text-atx-blue">↳</b> Rewards are quality-weighted — you&apos;re never diluted by mercenary farmers.
              </div>
            </div>
          </section>
        </>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
// Public front door — no wallet required to browse rewards / campaigns.
// The teams pitch lives on /teams; join / create / swap require a wallet.
export default function RewardsPage() {
  return (
    <>
      <MwNav />
      <Suspense fallback={null}>
        <RewardsContent />
      </Suspense>
    </>
  )
}

'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { API, fmtUSD, daysUntil } from '@/lib/web2/api'
import { AnimatedScore } from '@/components/web2/AnimatedScore'
import { CampaignCard, Campaign } from '@/components/rewards/campaigns/CampaignCard'
import { TokenIcon } from '@/components/web2/TokenIcon'
import { motion } from 'framer-motion'

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

  const [view, setView] = useState<'users' | 'teams'>('users')
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([])
  const [activeTab, setActiveTab] = useState<'explore' | 'mine'>('explore')
  const [currentFilter, setCurrentFilter] = useState('All')
  const [surface, setSurface] = useState<'all' | 'defi' | 'rwa'>('all')
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
    fetch(`${API}/score?address=${wallet}`)
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

      {/* ── Audience toggle ── */}
      <div className="border-b border-atx-ink bg-atx-panel">
        <div className="max-w-[1100px] mx-auto px-7 py-3.5 flex items-center justify-between gap-4 flex-wrap max-[800px]:px-4">
          <div className="font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-grey">
            {view === 'users' ? '✴ For earners' : '✴ For issuers & protocols'}
          </div>
          <div className="inline-flex border border-atx-ink">
            {(['users', 'teams'] as const).map((v, i) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`font-atx-mono text-[12px] uppercase tracking-[0.12em] px-7 py-2.5 cursor-pointer leading-tight ${i === 0 ? 'border-r border-atx-ink' : ''} ${view === v ? 'bg-atx-blue text-white' : 'bg-atx-bone text-atx-ink/55'}`}
              >
                {v === 'users' ? 'Users' : 'Teams'}
                <span className="block text-[9px] tracking-[0.06em] opacity-70 mt-0.5 normal-case">
                  {v === 'users' ? 'I want to earn' : 'I run a protocol / deal'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'users' ? (
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
                  Every swap, subscription, hold, and referral — across <b className="text-atx-ink">DeFi markets and real-world assets</b> — earns points, then multiplied by your Attribution score. Come get paid for the history you&apos;ve already built.
                </p>
                <div className="flex gap-2.5 mt-7 flex-wrap">
                  <a href="#campaigns" className={BTN_ACC}>Browse campaigns ↓</a>
                  <Link href="/profile" className={BTN}>See your score</Link>
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
                      Your score sets your multiplier on every action, in every campaign — up to 1.95×.
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

          {/* ── How earning works ── */}
          <section className="border-b border-atx-ink">
            <div className="max-w-[1100px] mx-auto px-7 py-[52px] max-[800px]:px-4">
              <div className={EY}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-acid" />Every action, both surfaces, rewarded</div>
              <h2 className={H2}>Four ways to earn. <span className="text-atx-blue">One multiplier.</span></h2>
              <p className={LEAD}>Earn on both surfaces — DeFi markets and real-world assets. Every action is scored, then multiplied by your reputation.</p>
              <div className="grid grid-cols-4 border border-atx-ink mt-7 max-[800px]:grid-cols-1">
                {[
                  ['Trade', 'DeFi + RWA', false, 'Swap on any pool — including the vRWA/USDC oracle-banded market. On RWA, your volume is what turns a tokenized asset into a liquid one.', '+8 pts / trade'],
                  ['Subscribe', 'RWA', true, 'Deposit into a deal at launch — the sticky primary capital an issuer actually needs. Credited the moment you commit.', '+ deal rate / subscribe'],
                  ['Hold', 'RWA · new', true, 'Keep vRWA through the epoch. A weekly snapshot credits you by balance × duration × reputation — hold-to-maturity, rewarded.', 'rate × held × duration'],
                  ['Refer', 'DeFi + RWA', false, 'Bring qualified buyers. On RWA this is placement-agent distribution — the referral that sources a real relationship, not a bot.', '+60 pts / referral'],
                ].map(([name, badge, rwa, desc, pts], i) => (
                  <div key={name as string} className={`p-5 ${i < 3 ? 'border-r border-atx-ink max-[800px]:border-r-0 max-[800px]:border-b' : ''}`}>
                    <div className="text-[19px] font-bold flex items-center gap-2 flex-wrap">
                      {name}
                      <span className={`font-atx-mono text-[9px] uppercase tracking-[0.1em] border border-atx-ink px-1.5 py-0.5 ${rwa ? 'bg-atx-coral' : 'bg-atx-acid'}`}>{badge}</span>
                    </div>
                    <div className="text-[13px] text-atx-ink/70 leading-[1.45] mt-2.5 min-h-[82px]">{desc}</div>
                    <div className="font-atx-mono text-[13px] text-atx-blue font-bold mt-2 border-t border-atx-ink/10 pt-2.5">{pts}</div>
                  </div>
                ))}
              </div>
              <div className="font-atx-mono text-[13px] text-atx-mesquite mt-4.5">
                <b className="text-atx-blue">↳</b> Same action, better reputation, bigger reward — and because rewards are quality-weighted, you&apos;re never diluted by mercenary farmers.
              </div>
            </div>
          </section>

          {/* ── Campaigns ── */}
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
                href="/create-campaign"
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
                {(['all', 'defi', 'rwa'] as const).map((s, i) => (
                  <button
                    key={s}
                    onClick={() => setSurface(s)}
                    className={`font-atx-mono text-[11px] uppercase tracking-[0.08em] px-3.5 py-1.5 cursor-pointer ${i > 0 ? 'border-l border-atx-ink' : ''} ${surface === s ? 'bg-atx-blue text-white' : 'bg-transparent text-atx-ink/55 hover:text-atx-ink'}`}
                  >
                    {s === 'all' ? 'All' : s === 'defi' ? 'DeFi' : 'RWA'}
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
                {/* Live section */}
                {filteredLive.length > 0 && (
                  <>
                    <div className={`${LABEL} mb-3.5`}>Live now</div>
                    <div className={`grid grid-cols-2 gap-4 max-[800px]:grid-cols-1 ${filteredUpcoming.length > 0 ? '' : 'mb-6'}`}>
                      {filteredLive.map((c, i) => (
                        <motion.div
                          key={c.id}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.35, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <CampaignCard campaign={c} />
                        </motion.div>
                      ))}
                      {filteredLive.length % 2 !== 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.35, delay: filteredLive.length * 0.07, ease: [0.22, 1, 0.36, 1] }}
                          className="p-7 flex flex-col justify-center gap-2 border border-dashed border-atx-ink/25 opacity-70"
                        >
                          <div className="text-[13px] font-medium text-atx-ink/70 font-atx-mono uppercase tracking-[0.04em]">More campaigns coming soon</div>
                          <div className="text-[12px] text-atx-ink/45">New protocol partnerships are being finalized. Check back weekly.</div>
                          <div className="text-[12px] text-atx-blue mt-1 cursor-pointer font-atx-mono">Get notified →</div>
                        </motion.div>
                      )}
                    </div>
                  </>
                )}

                {/* Upcoming section */}
                {filteredUpcoming.length > 0 && (
                  <>
                    <div className={`${LABEL} mb-3.5 ${filteredLive.length > 0 ? 'mt-6' : ''}`}>Upcoming</div>
                    <div className="flex flex-col gap-2 mb-6">
                      {filteredUpcoming.map(c => {
                        const daysToStart = c.start_date ? daysUntil(c.start_date) : null
                        return (
                          <div key={c.id} className="border border-atx-ink/25 border-dashed bg-atx-panel flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors duration-150 hover:border-atx-ink">
                            <TokenIcon
                              tokenAddress={c.token_contract}
                              chain={c.chain_id ?? c.chain}
                              name={c.protocol ?? c.name}
                              size={44}
                              borderRadius={0}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-[15px] font-semibold text-atx-ink mb-[3px]">{c.name}</div>
                              <div className="text-[12px] text-atx-ink/55 font-atx-mono">{c.chain}{c.pool_usd != null ? ` · ${fmtUSD(c.pool_usd)} pool` : ''}</div>
                            </div>
                            <div className="ml-auto shrink-0">
                              <span className="inline-flex items-center gap-[5px] border border-atx-ink/40 text-atx-clay px-3 py-[5px] text-[11px] font-semibold font-atx-mono uppercase tracking-[0.06em] whitespace-nowrap">
                                {daysToStart !== null ? `In ${daysToStart}d` : 'Soon'}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}

                {/* Ended section */}
                {filteredEnded.length > 0 && (
                  <>
                    <div className={`${LABEL} mb-3.5 mt-2`}>Ended</div>
                    <div className="grid grid-cols-2 gap-4 mb-6 max-[800px]:grid-cols-1">
                      {filteredEnded.map((c, i) => (
                        <motion.div
                          key={c.id}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <CampaignCard campaign={c} />
                        </motion.div>
                      ))}
                    </div>
                  </>
                )}

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
        </>
      ) : (
        <TeamsView />
      )}
    </div>
  )
}

// ─── Teams view (issuer / protocol pitch) ────────────────────────────────────────
function Cell({ k, h, p, shine = false }: { k: string; h: string; p: ReactNode; shine?: boolean }) {
  return (
    <div className={`p-6 border-r border-atx-ink last:border-r-0 max-[800px]:border-r-0 max-[800px]:border-b max-[800px]:last:border-b-0 ${shine ? 'bg-atx-panel shadow-[inset_0_3px_0_var(--color-atx-coral)]' : ''}`}>
      <div className={`font-atx-mono text-[11px] uppercase tracking-[0.14em] ${shine ? 'text-atx-mesquite' : 'text-atx-grey'}`}>{k}</div>
      <div className={`text-[20px] font-bold mt-2 ${shine ? 'text-atx-ink' : ''}`}>{h}</div>
      <div className="text-[13.5px] text-atx-ink/70 leading-[1.5] mt-2.5">{p}</div>
    </div>
  )
}

function Row({ good, children }: { good: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-3 items-start py-[11px] border-b border-atx-ink/10 last:border-b-0 text-[14px] leading-[1.45]">
      <span className={`font-atx-mono font-bold shrink-0 ${good ? 'text-atx-blue' : 'text-atx-ink/35'}`}>{good ? '✓' : '✕'}</span>
      <span>{children}</span>
    </div>
  )
}

function TeamsView() {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="max-w-[1100px] mx-auto px-7 grid grid-cols-[1.5fr_1fr] max-[820px]:grid-cols-1 max-[800px]:px-4">
          <div className="py-11 pr-9 max-[820px]:pr-0">
            <div className={EY}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-blue" />For teams · Issuers &amp; protocols</div>
            <h1 className="font-bold tracking-[-0.02em] leading-[0.99] text-[clamp(32px,4.6vw,54px)] mt-5 max-w-[17ch] text-wrap-balance">
              We measure Contribution and <span className="text-atx-blue">reward it.</span>
            </h1>
            <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-atx-ink/70 max-w-[54ch] mt-5">
              Tokenizing an asset is solved and commoditized. What isn&apos;t: your <b className="text-atx-ink">cold-start</b>, your <b className="text-atx-ink">distribution</b>, and your <b className="text-atx-ink">dead secondary market</b>. Mintware brings you sticky, eligible, relationship-sourced capital — rewarded by how good it is rather than how much — and makes the resulting position tradeable.
            </p>
            <div className="flex gap-2.5 mt-7 flex-wrap">
              <Link href="/create-campaign" className={BTN_ACC}>Launch a campaign →</Link>
              <a href="mailto:nic.robinson17@gmail.com?subject=Mintware%20for%20teams" className={BTN}>Talk to us</a>
            </div>
          </div>
          <div className="border-l border-atx-ink/20 pl-10 py-10 flex flex-col justify-center max-[820px]:border-l-0 max-[820px]:border-t max-[820px]:border-atx-ink/20 max-[820px]:pl-0 max-[820px]:pt-8">
            <div className={`${EY} mb-3.5`}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-blue" />The wedge</div>
            <div className="border border-atx-ink bg-atx-panel">
              {[
                ['Quality', 'rewarded, not quantity'],
                ['Duration-matched', 'capital that stays to maturity'],
                ['Permissionless', 'zero KYC in the engine — the token gates, not us'],
              ].map(([n, l]) => (
                <div key={n} className="px-[18px] py-4 border-b border-atx-ink/10 last:border-b-0">
                  <div className="font-atx-mono text-[24px] font-bold text-atx-blue tracking-[-1px] leading-none">{n}</div>
                  <div className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-grey mt-1.5">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-b border-atx-ink">
        <div className="max-w-[1100px] mx-auto px-7 py-[52px] max-[800px]:px-4">
          <div className={EY}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-blue" />Tokenizing is the easy part</div>
          <h2 className={H2}>Everything after the token is <span className="text-atx-blue">where deals die.</span></h2>
          <p className={LEAD}>A tokenized asset is just a wrapper until three things happen. Almost nobody has solved them together for RWAs — that&apos;s the gap.</p>
          <div className="grid grid-cols-3 border border-atx-ink mt-7 max-[800px]:grid-cols-1">
            <Cell k="01 · Cold-start" h="No capital on day one" p="A new deal launches to an empty book. You need qualified capital in the door before the economics work." />
            <Cell k="02 · Distribution" h="Reaching real buyers" p="Finding eligible, relationship-sourced demand — not paid mercenaries — is the placement problem every issuer faces." />
            <Cell shine k="03 · Secondary liquidity" h="Tokenized ≠ tradeable" p="Tokenization's broken promise. Secondary markets for tokenized credit and T-bills are thin to dead. An asset you can't exit is a roach motel." />
          </div>
        </div>
      </section>

      {/* Why reputation beats raw APY */}
      <section className="border-b border-atx-ink">
        <div className="max-w-[1100px] mx-auto px-7 py-[52px] max-[800px]:px-4">
          <div className={EY}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-blue" />Why reputation beats raw APY</div>
          <h2 className={H2}>Every DeFi rewards program fights its own users. <span className="text-atx-blue">RWAs flip it.</span></h2>
          <p className={LEAD}>An SPV wrapping a 90-day note doesn&apos;t want the most dollars — it wants capital whose <i>duration matches the asset</i>, and whose behaviour is sticky and qualified. That&apos;s a filter no issuer can buy with emissions.</p>
          <div className="grid grid-cols-2 border border-atx-ink mt-7 max-[800px]:grid-cols-1">
            <div className="p-6 border-r border-atx-ink bg-atx-panel max-[800px]:border-r-0 max-[800px]:border-b">
              <div className="font-atx-mono text-[12px] uppercase tracking-[0.14em] text-atx-ink/45">✕ Raw emissions</div>
              <div className="text-[12.5px] text-atx-grey mb-4 mt-1.5">The old way — mercenary by design</div>
              <Row good={false}><b>Attracts the capital you least want.</b> Farms the emission, dumps, leaves.</Row>
              <Row good={false}><b>Pays for noise.</b> Wash-traded volume you subsidise for a metric.</Row>
              <Row good={false}><b>Rewards size, not stickiness.</b> The biggest wallet wins, then exits first.</Row>
            </div>
            <div className="p-6">
              <div className="font-atx-mono text-[12px] uppercase tracking-[0.14em] text-atx-blue">✴ Mintware rewards</div>
              <div className="text-[12.5px] text-atx-grey mb-4 mt-1.5">Quality by design</div>
              <Row good><b>Duration-matched.</b> Capital locks to/through your settlement date.</Row>
              <Row good><b>Reputation-weighted.</b> Attribution score, lock, and referral quality — not dollar count.</Row>
              <Row good><b>Makes the token trade.</b> Volume + LP rewards give your asset a real secondary market.</Row>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap border border-atx-ink bg-atx-bone px-[22px] py-5 mt-6 font-atx-mono">
            <span className="text-[15px] font-bold">What you reward</span>
            <span className="text-atx-grey text-[20px]">=</span>
            <span className="border border-atx-ink px-3 py-2 text-[13px] bg-atx-panel"><b className="text-atx-blue">Attribution</b> score</span>
            <span className="text-atx-grey font-bold">×</span>
            <span className="border border-atx-ink px-3 py-2 text-[13px] bg-atx-panel"><b className="text-atx-blue">lock</b> duration</span>
            <span className="text-atx-grey font-bold">×</span>
            <span className="border border-atx-ink px-3 py-2 text-[13px] bg-atx-panel"><b className="text-atx-blue">referral</b> quality</span>
            <span className="text-atx-grey font-bold ml-1.5">not</span>
            <span className="border border-dashed border-atx-ink/30 px-3 py-2 text-[13px] text-atx-ink/40 line-through">how many dollars</span>
          </div>
        </div>
      </section>

      {/* Two surfaces */}
      <section className="border-b border-atx-ink">
        <div className="max-w-[1100px] mx-auto px-7 py-[52px] max-[800px]:px-4">
          <div className={EY}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-coral" />Two surfaces, one reputation engine</div>
          <h2 className={H2}>Built for RWA. <span className="text-atx-blue">Just as sharp on DeFi.</span></h2>
          <p className={LEAD}>Reputation-weighting reaches its full power on real-world assets — but the same filter upgrades any DeFi rewards program you run. Point a campaign at either.</p>
          <div className="grid grid-cols-2 border border-atx-ink mt-7 max-[800px]:grid-cols-1">
            <Cell shine k="Real-world assets · lead" h="Where it's transformative" p={<>Solves cold-start, distribution, and the dead secondary market at once. Duration-matched, qualified capital — and the volume that makes a tokenized asset finally trade. Nobody else has solved incentivised distribution <i>and</i> secondary liquidity, weighted by capital quality.</>} />
            <div className="p-6">
              <div className="font-atx-mono text-[11px] uppercase tracking-[0.14em] text-atx-blue">DeFi markets</div>
              <div className="text-[20px] font-bold mt-2 text-atx-blue">Reward the right users</div>
              <div className="text-[13.5px] text-atx-ink/70 leading-[1.5] mt-2.5">Point a campaign at any DeFi pool and reward loyal, high-reputation users instead of mercenary farmers. The same quality filter drives the retention and conversion raw emissions never could — your best users earn more, and stay.</div>
            </div>
          </div>
        </div>
      </section>

      {/* Outcomes */}
      <section className="border-b border-atx-ink">
        <div className="max-w-[1100px] mx-auto px-7 py-[52px] max-[800px]:px-4">
          <div className={EY}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-blue" />What it drives</div>
          <h2 className={H2}>Retention. Conversion. <span className="text-atx-blue">And the one RWAs are missing.</span></h2>
          <div className="grid grid-cols-3 border border-atx-ink mt-7 max-[800px]:grid-cols-1">
            <Cell k="Retention" h="Capital that stays" p="Duration-matched locks reward holding through maturity — you keep the capital exactly as long as the asset needs it." />
            <Cell k="Conversion" h="Qualified demand" p="Relationship-sourced referrals with a 24h anti-sybil gate. Placement, not spam — buyers who convert and stay." />
            <Cell shine k="Liquidity · RWA shines" h="A market, not a wrapper" p="Volume and LP rewards turn your dead secondary into a live one. The vRWA/USDC band is theoretical until real flow exists — this is the machine that creates it." />
          </div>
        </div>
      </section>

      {/* Lifecycle */}
      <section className="border-b border-atx-ink">
        <div className="max-w-[1100px] mx-auto px-7 py-[52px] max-[800px]:px-4">
          <div className={EY}><span className="w-[9px] h-[9px] border border-atx-ink inline-block bg-atx-blue" />One engine, both sides</div>
          <h2 className={H2}>Raise the deal <span className="text-atx-blue">and</span> keep it liquid.</h2>
          <p className={LEAD}>Secondary liquidity de-risks the primary — investors subscribe when they believe they can exit. The same campaign types cover the whole lifecycle.</p>
          <div className="overflow-x-auto mt-7">
            <table className="w-full border-collapse border border-atx-ink text-[13px] min-w-[600px]">
              <thead>
                <tr>
                  {['Campaign', 'Primary — raise the deal', 'Secondary — keep it liquid'].map(h => (
                    <th key={h} className="border border-atx-ink/20 bg-atx-panel px-3.5 py-3 text-left font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-grey">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Volume', '—', 'Real flow → price discovery, tighter bands, exit liquidity'],
                  ['Referral', 'Placement-agent distribution', 'Demand-side buyer acquisition'],
                  ['LP / vault', 'Seed the pool at launch', 'Attribution-weighted market-making that keeps vRWA tradeable'],
                  ['Subscribe / hold', 'Duration-matched sticky capital', 'Hold-to-maturity bonus'],
                ].map(([v, pr, se]) => (
                  <tr key={v}>
                    <td className="border border-atx-ink/20 px-3.5 py-3 font-atx-mono text-[12px] font-bold whitespace-nowrap align-top">{v}</td>
                    <td className={`border border-atx-ink/20 px-3.5 py-3 align-top leading-[1.4] ${pr === '—' ? 'text-atx-ink/30' : 'text-atx-ink/80'}`}>{pr}</td>
                    <td className="border border-atx-ink/20 px-3.5 py-3 align-top leading-[1.4] text-atx-ink/80">{se}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[clamp(19px,2.5vw,28px)] font-bold tracking-[-0.5px] leading-[1.25] max-w-[30ch] mt-9">
            We don&apos;t tokenize your asset. <span className="text-atx-blue">We make it work.</span>
          </div>
          <div className="mt-7">
            <Link href="/create-campaign" className={BTN_ACC}>Launch a campaign →</Link>
          </div>
        </div>
      </section>
    </>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
// Public front door — no wallet required to browse rewards + the teams pitch.
// Join / create / swap still require a wallet on their own flows.
export default function RewardsPage() {
  return (
    <>
      <MwNav />
      <RewardsContent />
    </>
  )
}

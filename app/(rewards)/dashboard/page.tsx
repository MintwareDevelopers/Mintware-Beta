'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
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

// ─── Dashboard Content ─────────────────────────────────────────────────────────
function DashboardContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const searchParams = useSearchParams()

  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([])
  const [activeTab, setActiveTab] = useState<'explore' | 'mine'>('explore')
  const [currentFilter, setCurrentFilter] = useState('All')
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

  const stats = [
    { label: 'Total pool value', value: totalPool > 0 ? fmtUSD(totalPool) : '—', sub: `↑ ${liveCount} active campaign${liveCount !== 1 ? 's' : ''}`, valueColor: 'var(--color-mw-brand)' },
    { label: 'Daily payout',     value: totalDaily > 0 ? fmtUSD(totalDaily) : '—', sub: 'distributed per day', valueColor: 'var(--color-mw-green)' },
    { label: 'Your points',      value: userScore !== null ? userScore.toLocaleString() : '0', sub: wallet ? 'Attribution score' : 'Start trading to earn', subGray: !wallet, valueColor: 'var(--color-mw-brand)' },
    { label: 'Min score',        value: minScore !== null ? `${minScore}+` : '—', sub: 'to qualify', subGray: true },
  ]

  const filterDefs = [
    { key: 'All',      count: null },
    { key: 'Live',     count: liveCount > 0 ? liveCount : null },
    { key: 'Upcoming', count: upcomingCount > 0 ? upcomingCount : null },
    { key: 'Ended',    count: null },
  ]

  function getFiltered() {
    const base = activeTab === 'mine' ? allCampaigns.filter(c => myCampaignIds.has(c.id)) : allCampaigns
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
    <div className="page-earn bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
      <div className="px-7 pb-12 pt-6 max-w-[1100px] mx-auto max-[800px]:px-4 max-[800px]:pt-5 max-[800px]:pb-10">
        {error && (
          <div className="border border-atx-clay text-atx-clay px-[14px] py-[10px] text-[13px] mb-4 font-atx-mono">
            {error}
          </div>
        )}

        {/* ── Attribution hero ── */}
        <div className="border border-atx-ink mb-7 overflow-hidden relative" style={{ backgroundImage: GRID_BG }}>

          <div className="flex items-stretch relative max-[720px]:flex-col">

            {/* Left: Your Attribution score */}
            <div className="flex-1 p-8 pb-7">
              <div className="flex items-center gap-[7px] mb-5">
                <span className="w-[9px] h-[9px] bg-atx-acid border border-atx-ink shrink-0" />
                <span className={LABEL}>Your Attribution</span>
              </div>

              {wallet ? (
                <>
                  <div className="text-[64px] font-bold text-atx-blue tracking-[-3px] leading-none font-atx-mono mb-3">
                    {userScore !== null
                      ? <><AnimatedScore value={userScore} /><span className="text-[20px] font-medium text-atx-ink/30 ml-[10px] tracking-normal">pts</span></>
                      : <span className="text-atx-ink/20">—</span>
                    }
                  </div>
                  {userTier && (
                    <div className="inline-flex items-center gap-[8px] border border-atx-ink bg-atx-panel px-3 py-1 mb-[14px]">
                      <span className="text-[12px] font-semibold text-atx-blue font-atx-mono uppercase tracking-[0.04em]">{userTier} tier</span>
                      {userPercentile !== null && (
                        <span className="text-[11px] text-atx-ink/55 font-atx-mono">· top {100 - userPercentile}%</span>
                      )}
                    </div>
                  )}
                  <div className="text-[13px] text-atx-ink/55 leading-relaxed max-w-[260px]">
                    Your score determines your share of every active campaign pool.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[52px] font-bold text-atx-ink/15 tracking-[-3px] leading-none font-atx-mono mb-4">?</div>
                  <div className="text-[15px] font-semibold text-atx-ink mb-2 leading-snug">
                    Your score is waiting.
                  </div>
                  <div className="text-[13px] text-atx-ink/55 leading-relaxed max-w-[240px]">
                    Connect your wallet to see your Attribution score and unlock campaign rewards.
                  </div>
                </>
              )}
            </div>

            {/* Vertical divider */}
            <div className="w-px bg-atx-ink/20 shrink-0 self-stretch max-[720px]:w-full max-[720px]:h-px" />

            {/* Right: Active campaign stats */}
            <div className="flex-1 p-8 pb-7">
              <div className={`${LABEL} mb-5`}>Active campaigns</div>
              <div className="grid grid-cols-2 gap-x-7 gap-y-5">
                {([
                  { val: totalPool > 0   ? fmtUSD(totalPool)   : '—', lbl: 'Total pool',   color: 'var(--color-atx-blue)' },
                  { val: totalDaily > 0  ? fmtUSD(totalDaily)  : '—', lbl: 'Daily payout', color: 'var(--color-atx-coral)' },
                  { val: liveCount > 0   ? String(liveCount)   : '—', lbl: 'Live now',      color: 'var(--color-atx-ink)' },
                  { val: minScore !== null ? `${minScore}+`    : '—', lbl: 'Min score',     color: 'var(--color-atx-blue)' },
                ] as const).map((s, i) => (
                  <div key={i}>
                    <div className="text-[28px] font-bold leading-none font-atx-mono tracking-[-1px]" style={{ color: s.color }}>{s.val}</div>
                    <div className="text-[10px] text-atx-ink/45 uppercase tracking-[0.1em] mt-[6px] font-atx-mono">{s.lbl}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex gap-0 border border-atx-ink w-fit">
            <button
              className={`py-[8px] px-4 text-[12px] cursor-pointer font-atx-mono uppercase tracking-[0.06em] transition-colors duration-150 ${activeTab === 'explore' ? 'bg-atx-blue text-white font-semibold' : 'bg-transparent text-atx-ink/60 hover:text-atx-ink'}`}
              onClick={() => setActiveTab('explore')}
            >Explore</button>
            <button
              className={`py-[8px] px-4 text-[12px] cursor-pointer font-atx-mono uppercase tracking-[0.06em] border-l border-atx-ink transition-colors duration-150 ${activeTab === 'mine' ? 'bg-atx-blue text-white font-semibold' : 'bg-transparent text-atx-ink/60 hover:text-atx-ink'}`}
              onClick={() => setActiveTab('mine')}
            >My Campaigns</button>
          </div>
          <Link
            href="/create-campaign"
            className="inline-flex items-center gap-[6px] bg-atx-blue text-white text-[12px] font-semibold font-atx-mono uppercase tracking-[0.05em] py-[8px] px-4 border border-atx-ink no-underline shrink-0 transition-opacity duration-150 hover:opacity-90"
          >
            + Create campaign
          </Link>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-5 items-center flex-wrap">
          {filterDefs.map(f => (
            <button
              key={f.key}
              className={`text-[12px] font-medium font-atx-mono uppercase tracking-[0.06em] py-[6px] px-4 cursor-pointer inline-flex items-center gap-1.5 border transition-colors duration-150 ${
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
                <div className={`${LABEL} mb-[14px]`}>Live now</div>
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
                <div className={`${LABEL} mb-[14px] ${filteredLive.length > 0 ? 'mt-6' : ''}`}>Upcoming</div>
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
                <div className={`${LABEL} mb-[14px] mt-2`}>Ended</div>
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
              <div className={`${LABEL} mb-[14px]`}>Recent activity</div>
              <div className="flex flex-col gap-[6px]">
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
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  return (
    <>
      <MwNav />
      <MwAuthGuard>
        <DashboardContent />
      </MwAuthGuard>
    </>
  )
}

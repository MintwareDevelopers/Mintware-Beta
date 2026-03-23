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
    <div className="page-earn bg-mw-bg min-h-screen">
      <div className="px-7 pb-12 pt-6 max-w-[1100px] mx-auto max-[800px]:px-4 max-[800px]:pt-5 max-[800px]:pb-10">
        {error && (
          <div className="bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)] rounded-[10px] px-[14px] py-[10px] text-[13px] text-[#dc2626] mb-4 font-sans">
            {error}
          </div>
        )}

        {/* ── Attribution hero ── */}
        <div className="mw-hero-gradient rounded-lg mb-7 overflow-hidden relative">

          <div className="flex items-stretch relative">

            {/* Left: Your Attribution score */}
            <div className="flex-1 p-8 pb-7">
              <div className="flex items-center gap-[6px] mb-5">
                <div className="w-[5px] h-[5px] rounded-full bg-mw-live shrink-0" />
                <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-mw-live font-sans">Your Attribution</span>
              </div>

              {wallet ? (
                <>
                  <div className="text-[64px] font-bold text-mw-brand tracking-[-3px] leading-none font-mono mb-3">
                    {userScore !== null
                      ? <><AnimatedScore value={userScore} /><span className="text-[20px] font-medium text-[rgba(15,23,42,0.30)] ml-[10px] tracking-normal">pts</span></>
                      : <span className="text-[rgba(15,23,42,0.20)]">—</span>
                    }
                  </div>
                  {userTier && (
                    <div className="inline-flex items-center gap-[6px] bg-[rgba(79,126,247,0.14)] border border-[rgba(79,126,247,0.28)] rounded-[20px] px-3 py-1 mb-[14px]">
                      <span className="text-[12px] font-semibold text-mw-brand font-sans">{userTier} tier</span>
                      {userPercentile !== null && (
                        <span className="text-[11px] text-mw-ink-3 font-sans">· top {100 - userPercentile}%</span>
                      )}
                    </div>
                  )}
                  <div className="text-[13px] text-mw-ink-3 leading-relaxed max-w-[260px] font-sans">
                    Your score determines your share of every active campaign pool.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[52px] font-bold text-[rgba(15,23,42,0.12)] tracking-[-3px] leading-none font-mono mb-4">?</div>
                  <div className="text-[15px] font-semibold text-mw-ink mb-2 font-sans leading-snug">
                    Your score is waiting.
                  </div>
                  <div className="text-[13px] text-mw-ink-3 leading-relaxed max-w-[240px] font-sans">
                    Connect your wallet to see your Attribution score and unlock campaign rewards.
                  </div>
                </>
              )}
            </div>

            {/* Vertical divider */}
            <div className="w-[0.5px] bg-[rgba(15,23,42,0.08)] shrink-0 self-stretch" />

            {/* Right: Active campaign stats */}
            <div className="flex-1 p-8 pb-7">
              <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-mw-ink-3 mb-5 font-sans">
                Active campaigns
              </div>
              <div className="grid grid-cols-2 gap-x-7 gap-y-5">
                {([
                  { val: totalPool > 0   ? fmtUSD(totalPool)   : '—', lbl: 'Total pool',   color: 'var(--color-mw-brand)' },
                  { val: totalDaily > 0  ? fmtUSD(totalDaily)  : '—', lbl: 'Daily payout', color: 'var(--color-mw-brand)' },
                  { val: liveCount > 0   ? String(liveCount)   : '—', lbl: 'Live now',      color: 'var(--color-mw-ink)' },
                  { val: minScore !== null ? `${minScore}+`    : '—', lbl: 'Min score',     color: 'var(--color-mw-brand)' },
                ] as const).map((s, i) => (
                  <div key={i}>
                    <div className="text-[28px] font-bold leading-none font-mono tracking-[-1px]" style={{ color: s.color }}>{s.val}</div>
                    <div className="text-[10px] text-mw-ink-5 uppercase tracking-[0.08em] mt-[6px] font-sans">{s.lbl}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex gap-1">
            <button
              className={`py-[7px] px-4 rounded-xl text-[13px] cursor-pointer font-sans transition-colors duration-150 ${activeTab === 'explore' ? 'bg-mw-brand text-white font-semibold border-0' : 'mw-accent-pill border-0'}`}
              onClick={() => setActiveTab('explore')}
            >Explore</button>
            <button
              className={`py-[7px] px-4 rounded-xl text-[13px] cursor-pointer font-sans transition-colors duration-150 ${activeTab === 'mine' ? 'bg-mw-brand text-white font-semibold border-0' : 'mw-accent-pill border-0'}`}
              onClick={() => setActiveTab('mine')}
            >My Campaigns</button>
          </div>
          <Link
            href="/create-campaign"
            className="inline-flex items-center gap-[6px] bg-mw-brand text-white text-[13px] font-semibold font-sans py-[7px] px-4 rounded-xl no-underline shrink-0 transition-opacity duration-150 hover:opacity-85"
          >
            + Create campaign
          </Link>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-5 items-center flex-wrap">
          {filterDefs.map(f => (
            <button
              key={f.key}
              className={`rounded-full text-[13px] font-medium font-sans py-[5px] px-4 cursor-pointer inline-flex items-center gap-1 transition-colors duration-150 ${
                currentFilter === f.key
                  ? 'border border-mw-brand text-mw-brand bg-mw-brand-dim'
                  : 'mw-accent-pill border-0'
              }`}
              onClick={() => setCurrentFilter(f.key)}
            >
              {f.key}
              {f.count !== null && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-mw-brand text-white text-[10px] font-semibold">
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {(loading || mineLoading) ? (
          <div className="grid grid-cols-2 gap-4 max-[800px]:grid-cols-1">
            <div className="mw-accent-card rounded-md shadow-card p-5 min-h-[160px]" />
            <div className="mw-accent-card rounded-md shadow-card p-5 min-h-[160px]" />
          </div>
        ) : activeTab === 'mine' && !wallet ? (
          <div className="text-center py-12 px-5 text-mw-ink-3 text-[14px] font-sans">
            Connect your wallet to see your campaigns.
          </div>
        ) : activeTab === 'mine' && filtered.length === 0 ? (
          <div className="text-center py-12 px-5 text-[#6b7280] text-[14px] font-sans">
            You haven&apos;t joined any campaigns yet.{' '}
            <span className="text-[#4f7ef7] cursor-pointer" onClick={() => setActiveTab('explore')}>Browse campaigns →</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 px-5 text-mw-ink-3 text-[14px] font-sans">
            No campaigns match this filter.
          </div>
        ) : (
          <>
            {/* Live section */}
            {filteredLive.length > 0 && (
              <>
                <div className="text-[11px] font-bold text-mw-ink-3 mb-[14px] tracking-[1px] uppercase font-sans">Live now</div>
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
                      className="p-7 flex flex-col justify-center gap-2 border border-dashed border-[rgba(0,0,0,0.12)] rounded-md opacity-65"
                    >
                      <div className="text-[13px] font-medium text-mw-ink-3 font-sans">More campaigns coming soon</div>
                      <div className="text-[12px] text-mw-ink-5 font-sans">New protocol partnerships are being finalized. Check back weekly.</div>
                      <div className="text-[12px] text-mw-brand mt-1 cursor-pointer font-sans">Get notified →</div>
                    </motion.div>
                  )}
                </div>
              </>
            )}

            {/* Upcoming section */}
            {filteredUpcoming.length > 0 && (
              <>
                <div className={`text-[11px] font-bold text-mw-ink-3 mb-[14px] tracking-[1px] uppercase font-sans ${filteredLive.length > 0 ? 'mt-6' : ''}`}>Upcoming</div>
                <div className="flex flex-col gap-2 mb-6">
                  {filteredUpcoming.map(c => {
                    const daysToStart = c.start_date ? daysUntil(c.start_date) : null
                    return (
                      <div key={c.id} className="mw-accent-card flex items-center gap-4 px-5 py-4 border-dashed rounded-md cursor-pointer transition-shadow duration-150 shadow-card hover:shadow-card-hover">
                        <TokenIcon
                          tokenAddress={c.token_contract}
                          chain={c.chain_id ?? c.chain}
                          name={c.protocol ?? c.name}
                          size={44}
                          borderRadius={10}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[15px] font-semibold text-mw-ink font-sans mb-[3px]">{c.name}</div>
                          <div className="text-[13px] text-mw-ink-3 font-sans">{c.chain}{c.pool_usd != null ? ` · ${fmtUSD(c.pool_usd)} pool` : ''}</div>
                        </div>
                        <div className="ml-auto shrink-0">
                          <span className="inline-flex items-center gap-[5px] bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.25)] text-[#d97706] rounded-full px-3 py-[5px] text-[12px] font-semibold font-sans whitespace-nowrap">
                            ◷ {daysToStart !== null ? `In ${daysToStart}d` : 'Soon'}
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
                <div className="text-[11px] font-bold text-mw-ink-3 mb-[14px] tracking-[1px] uppercase font-sans mt-2">Ended</div>
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
              <div className="text-[11px] font-bold text-mw-ink-3 mb-[14px] tracking-[1px] uppercase font-sans">Recent activity</div>
              <div className="flex flex-col gap-[6px]">
                {wallet ? (
                  <div className="mw-accent-card px-4 py-8 text-center text-mw-ink-3 text-[13px] font-sans rounded-[10px] shadow-card">No activity yet — join a campaign and start trading to see your history here.</div>
                ) : (
                  <div className="mw-accent-card px-4 py-8 text-center text-mw-ink-3 text-[13px] font-sans rounded-[10px] shadow-card">Connect your wallet to see recent activity.</div>
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

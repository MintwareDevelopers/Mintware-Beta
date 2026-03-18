'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { API, fmtUSD, iconColor, daysUntil } from '@/lib/api'
import { CampaignCard, Campaign } from '@/components/campaigns/CampaignCard'

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
  const [userScore, setUserScore] = useState<number | null>(null)

  // Track referrer from URL
  useEffect(() => {
    const ref = searchParams.get('ref') || searchParams.get('r')
    if (ref) sessionStorage.setItem('mw_pending_ref', ref)
  }, [searchParams])

  // Load Attribution score for "your points" stat
  useEffect(() => {
    if (!wallet) return
    fetch(`${API}/score?address=${wallet}`)
      .then(r => r.json())
      .then(d => setUserScore(d.score ?? 0))
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

  // Derived stats
  const liveCampaigns   = allCampaigns.filter(c => c.status === 'live')
  const upcomingCampaigns = allCampaigns.filter(c => c.status === 'upcoming')
  const totalPool   = liveCampaigns.reduce((s, c) => s + (c.pool_usd ?? 0), 0)
  const totalDaily  = liveCampaigns.reduce((s, c) => s + (c.daily_payout_usd ?? 0), 0)
  const minScore    = liveCampaigns[0]?.min_score ?? null
  const liveCount   = liveCampaigns.length
  const upcomingCount = upcomingCampaigns.length

  const stats = [
    { label: 'Total pool value', value: totalPool > 0 ? fmtUSD(totalPool) : '—', sub: `↑ ${liveCount} active campaign${liveCount !== 1 ? 's' : ''}` },
    { label: 'Daily payout',     value: totalDaily > 0 ? fmtUSD(totalDaily) : '—', sub: 'distributed per day' },
    { label: 'Your points',      value: userScore !== null ? userScore.toLocaleString() : '0', sub: wallet ? 'Attribution score' : 'Start trading to earn', subGray: !wallet },
    { label: 'Min score',        value: minScore !== null ? `${minScore}+` : '—', sub: 'to qualify', subGray: true },
  ]

  const filterDefs = [
    { key: 'All',      count: null },
    { key: 'Live',     count: liveCount > 0 ? liveCount : null },
    { key: 'Upcoming', count: upcomingCount > 0 ? upcomingCount : null },
    { key: 'Ended',    count: null },
  ]

  function getFiltered() {
    if (currentFilter === 'Live')     return allCampaigns.filter(c => c.status === 'live')
    if (currentFilter === 'Upcoming') return allCampaigns.filter(c => c.status === 'upcoming')
    if (currentFilter === 'Ended')    return allCampaigns.filter(c => c.status === 'ended')
    return allCampaigns
  }

  const filtered         = getFiltered()
  const filteredLive     = filtered.filter(c => c.status === 'live')
  const filteredUpcoming = filtered.filter(c => c.status === 'upcoming')
  const filteredEnded    = filtered.filter(c => c.status === 'ended')

  return (
    <>
      <style>{`
        .db-page { padding: 28px 28px 48px; max-width: 1100px; margin: 0 auto; }
        .db-tag  { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; color: #22c55e; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 8px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-tag-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
        .db-title { font-size: 30px; font-weight: 600; letter-spacing: -0.5px; color: #1a1a1a; line-height: 1.1; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-sub   { font-size: 14px; color: #6b7280; margin-top: 6px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0 28px; }
        .db-stat  { background: #f9f9fb; border: 0.5px solid rgba(0,0,0,0.08); border-radius: 12px; padding: 16px 18px; }
        .db-stat-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-stat-value { font-size: 22px; font-weight: 600; letter-spacing: -0.5px; color: #1a1a1a; font-family: 'DM Mono', monospace; }
        .db-stat-sub   { font-size: 11px; margin-top: 3px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-tabs   { display: flex; gap: 4px; margin-bottom: 20px; }
        .db-tab    { padding: 7px 16px; border-radius: 20px; font-size: 13px; cursor: pointer; border: none; background: none; color: #6b7280; font-family: 'Plus Jakarta Sans', sans-serif; transition: background 0.15s, color 0.15s; }
        .db-tab.active { background: #4f7ef7; color: #fff; font-weight: 500; }
        .db-filters { display: flex; gap: 8px; margin-bottom: 20px; align-items: center; flex-wrap: wrap; }
        .db-filter  { padding: 5px 14px; border-radius: 20px; font-size: 12px; cursor: pointer; border: 0.5px solid rgba(0,0,0,0.1); background: #fff; color: #6b7280; font-family: 'Plus Jakarta Sans', sans-serif; display: inline-flex; align-items: center; gap: 4px; }
        .db-filter.active { border-color: #4f7ef7; color: #4f7ef7; background: rgba(79,126,247,0.07); font-weight: 500; }
        .db-filter-count { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: #4f7ef7; color: #fff; font-size: 10px; font-weight: 600; }
        .db-section-title { font-size: 13px; font-weight: 500; color: #6b7280; margin-bottom: 12px; letter-spacing: 0.2px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-grid  { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
        .db-upcoming { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
        .db-upc-row  { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: #f9f9fb; border: 0.5px dashed rgba(0,0,0,0.12); border-radius: 12px; cursor: pointer; transition: border-color 0.15s; }
        .db-upc-row:hover { border-color: rgba(79,126,247,0.4); border-style: solid; }
        .db-upc-icon { width: 36px; height: 36px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; border: 0.5px solid rgba(0,0,0,0.07); font-family: 'DM Mono', monospace; }
        .db-upc-name { font-size: 14px; font-weight: 600; color: #1a1a1a; font-family: 'Plus Jakarta Sans', sans-serif; margin-bottom: 2px; }
        .db-upc-meta { font-size: 12px; color: #6b7280; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-upc-badge { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; background: rgba(245,158,11,0.1); color: #d97706; border: 0.5px solid rgba(245,158,11,0.3); font-family: 'Plus Jakarta Sans', sans-serif; white-space: nowrap; }
        .db-upc-pool  { font-size: 13px; font-weight: 600; color: #1a1a1a; font-family: 'DM Mono', monospace; white-space: nowrap; margin-right: 8px; }
        .db-skeleton  { background: #f9f9fb; border-radius: 12px; border: 0.5px solid rgba(0,0,0,0.07); padding: 20px; min-height: 160px; }
        .db-coming-soon { padding: 28px; display: flex; flex-direction: column; justify-content: center; gap: 8px; border: 0.5px dashed rgba(0,0,0,0.12); border-radius: 12px; opacity: 0.65; }
        @media (max-width: 800px) {
          .db-stats { grid-template-columns: repeat(2, 1fr); }
          .db-grid  { grid-template-columns: 1fr; }
          .db-page  { padding: 20px 16px 40px; }
        }
      `}</style>
      <div className="db-page">
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '0.5px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 16, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            {error}
          </div>
        )}

        {/* Page header */}
        <div className="db-tag"><div className="db-tag-dot" />EARN</div>
        <div className="db-title">Campaigns</div>
        <div className="db-sub">Browse active campaigns and join to earn points and token rewards.</div>

        {/* Stats bar */}
        <div className="db-stats">
          {stats.map(s => (
            <div key={s.label} className="db-stat">
              <div className="db-stat-label">{s.label}</div>
              <div className="db-stat-value">{s.value}</div>
              <div className="db-stat-sub" style={{ color: s.subGray ? '#9ca3af' : '#22c55e' }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="db-tabs">
          <button className={`db-tab${activeTab === 'explore' ? ' active' : ''}`} onClick={() => setActiveTab('explore')}>Explore</button>
          <button className={`db-tab${activeTab === 'mine'    ? ' active' : ''}`} onClick={() => setActiveTab('mine')}>My Campaigns</button>
        </div>

        {/* Filters */}
        <div className="db-filters">
          {filterDefs.map(f => (
            <button
              key={f.key}
              className={`db-filter${currentFilter === f.key ? ' active' : ''}`}
              onClick={() => setCurrentFilter(f.key)}
            >
              {f.key}
              {f.count !== null && <span className="db-filter-count">{f.count}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="db-grid">
            <div className="db-skeleton" />
            <div className="db-skeleton" />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#6b7280', fontSize: 14, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            No campaigns match this filter.
          </div>
        ) : (
          <>
            {/* Live section */}
            {filteredLive.length > 0 && (
              <>
                <div className="db-section-title">Live now</div>
                <div className="db-grid" style={{ marginBottom: filteredUpcoming.length > 0 ? 0 : 24 }}>
                  {filteredLive.map(c => <CampaignCard key={c.id} campaign={c} />)}
                  {filteredLive.length % 2 !== 0 && (
                    <div className="db-coming-soon">
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#6b7280', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>More campaigns coming soon</div>
                      <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>New protocol partnerships are being finalized. Check back weekly.</div>
                      <div style={{ fontSize: 12, color: '#4f7ef7', marginTop: 4, cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Get notified →</div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Upcoming section */}
            {filteredUpcoming.length > 0 && (
              <>
                <div className="db-section-title" style={{ marginTop: filteredLive.length > 0 ? 24 : 0 }}>Upcoming</div>
                <div className="db-upcoming">
                  {filteredUpcoming.map(c => {
                    const col         = iconColor(c.name)
                    const initial     = (c.protocol ?? c.name).charAt(0).toUpperCase()
                    const daysToStart = c.start_date ? daysUntil(c.start_date) : null
                    return (
                      <div key={c.id} className="db-upc-row">
                        <div className="db-upc-icon" style={{ background: col.bg, color: col.fg }}>{initial}</div>
                        <div>
                          <div className="db-upc-name">{c.name}</div>
                          <div className="db-upc-meta">{c.chain}{daysToStart !== null ? ` · Starts in ~${daysToStart}d` : ''}</div>
                        </div>
                        {c.pool_usd != null && <div style={{ marginLeft: 'auto' }} className="db-upc-pool">Est. {fmtUSD(c.pool_usd)}</div>}
                        <div className="db-upc-badge">◷ Upcoming</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* Ended section */}
            {filteredEnded.length > 0 && (
              <>
                <div className="db-section-title" style={{ marginTop: 8 }}>Ended</div>
                <div className="db-grid">
                  {filteredEnded.map(c => <CampaignCard key={c.id} campaign={c} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
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

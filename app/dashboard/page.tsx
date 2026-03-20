'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { API, fmtUSD, daysUntil } from '@/lib/api'
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
  const [myCampaignIds, setMyCampaignIds] = useState<Set<string>>(new Set())
  const [mineLoading, setMineLoading] = useState(false)

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
    <>
      <style>{`
        .db-page { padding: 28px 28px 48px; max-width: 1100px; margin: 0 auto; }
        .db-tag  { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; color: var(--color-mw-live); letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 8px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-tag-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-mw-live); }
        .db-title { font-size: 30px; font-weight: 600; letter-spacing: -0.5px; color: var(--color-mw-ink); line-height: 1.1; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-sub   { font-size: 14px; color: var(--color-mw-ink-3); margin-top: 6px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0 28px; }
        .db-stat  { background: var(--color-mw-surface-card); border: 0.5px solid var(--color-mw-border); border-radius: var(--radius-md); padding: 16px 18px; }
        .db-stat-label { font-size: 11px; color: var(--color-mw-ink-3); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-stat-value { font-size: 22px; font-weight: 600; letter-spacing: -0.5px; color: var(--color-mw-ink); font-family: 'DM Mono', monospace; }
        .db-stat-sub   { font-size: 11px; margin-top: 3px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-tabs   { display: flex; gap: 4px; margin-bottom: 20px; }
        .db-tab    { padding: 7px 16px; border-radius: var(--radius-xl); font-size: 13px; cursor: pointer; border: none; background: none; color: var(--color-mw-ink-3); font-family: 'Plus Jakarta Sans', sans-serif; transition: background var(--transition-fast), color var(--transition-fast); }
        .db-tab.active { background: var(--color-mw-brand); color: #fff; font-weight: 500; }
        .db-filters { display: flex; gap: 8px; margin-bottom: 20px; align-items: center; flex-wrap: wrap; }
        .db-filter  { padding: 5px 14px; border-radius: var(--radius-xl); font-size: 12px; cursor: pointer; border: 0.5px solid rgba(0,0,0,0.1); background: #fff; color: var(--color-mw-ink-3); font-family: 'Plus Jakarta Sans', sans-serif; display: inline-flex; align-items: center; gap: 4px; }
        .db-filter.active { border-color: var(--color-mw-brand); color: var(--color-mw-brand); background: var(--color-mw-brand-dim); font-weight: 500; }
        .db-filter-count { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: var(--color-mw-brand); color: #fff; font-size: 10px; font-weight: 600; }
        .db-section-title { font-size: 13px; font-weight: 500; color: var(--color-mw-ink-3); margin-bottom: 12px; letter-spacing: 0.2px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-grid  { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
        .db-upcoming { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
        .db-upc-row  { display: flex; align-items: center; gap: 16px; padding: 24px; background: var(--color-mw-surface-card); border: 0.5px dashed rgba(0,0,0,0.15); border-radius: var(--radius-md); cursor: pointer; transition: border-color var(--transition-fast), background var(--transition-fast); }
        .db-upc-row:hover { border-color: rgba(79,126,247,0.3); border-style: dashed; background: #f5f5f8; }
        .db-upc-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; flex-shrink: 0; border: 0.5px solid var(--color-mw-border); background: #fff; color: var(--color-mw-ink-3); font-family: 'DM Mono', monospace; }
        .db-upc-name { font-size: 14px; font-weight: 600; color: var(--color-mw-ink); font-family: 'Plus Jakarta Sans', sans-serif; margin-bottom: 3px; }
        .db-upc-meta { font-size: 12px; color: var(--color-mw-ink-3); font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-upc-right { margin-left: auto; text-align: right; flex-shrink: 0; }
        .db-upc-pool  { font-size: 12px; color: var(--color-mw-ink-3); font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-upc-badge { font-size: 12px; font-weight: 500; color: #f59e0b; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-activity { margin-top: 28px; }
        .db-act-list { display: flex; flex-direction: column; gap: 8px; }
        .db-act-row  { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #fff; border: 0.5px solid var(--color-mw-border); border-radius: 10px; }
        .db-act-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .db-act-text { flex: 1; font-size: 13px; color: var(--color-mw-ink); font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-act-time { font-size: 11px; color: var(--color-mw-ink-5); font-family: 'Plus Jakarta Sans', sans-serif; white-space: nowrap; }
        .db-act-pts  { font-size: 13px; font-weight: 600; color: var(--color-mw-live); font-family: 'DM Mono', monospace; white-space: nowrap; }
        .db-act-empty { padding: 24px; text-align: center; color: var(--color-mw-ink-5); font-size: 13px; font-family: 'Plus Jakarta Sans', sans-serif; border: 0.5px solid var(--color-mw-border); border-radius: 10px; background: var(--color-mw-surface-card); }
        .db-skeleton  { background: var(--color-mw-surface-card); border-radius: var(--radius-md); border: 0.5px solid var(--color-mw-border); padding: 20px; min-height: 160px; }
        .db-coming-soon { padding: 28px; display: flex; flex-direction: column; justify-content: center; gap: 8px; border: 0.5px dashed rgba(0,0,0,0.12); border-radius: var(--radius-md); opacity: 0.65; }
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
              <div className="db-stat-sub" style={{ color: s.subGray ? 'var(--color-mw-ink-5)' : 'var(--color-mw-live)' }}>{s.sub}</div>
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

        {(loading || mineLoading) ? (
          <div className="db-grid">
            <div className="db-skeleton" />
            <div className="db-skeleton" />
          </div>
        ) : activeTab === 'mine' && !wallet ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#6b7280', fontSize: 14, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            Connect your wallet to see your campaigns.
          </div>
        ) : activeTab === 'mine' && filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#6b7280', fontSize: 14, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            You haven&apos;t joined any campaigns yet.{' '}
            <span style={{ color: '#4f7ef7', cursor: 'pointer' }} onClick={() => setActiveTab('explore')}>Browse campaigns →</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-mw-ink-3)', fontSize: 14, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
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
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-mw-ink-3)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>More campaigns coming soon</div>
                      <div style={{ fontSize: 12, color: 'var(--color-mw-ink-5)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>New protocol partnerships are being finalized. Check back weekly.</div>
                      <div style={{ fontSize: 12, color: 'var(--color-mw-brand)', marginTop: 4, cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Get notified →</div>
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
                    const initial     = (c.protocol ?? c.name).charAt(0).toUpperCase()
                    const daysToStart = c.start_date ? daysUntil(c.start_date) : null
                    return (
                      <div key={c.id} className="db-upc-row">
                        <div className="db-upc-icon">{initial}</div>
                        <div>
                          <div className="db-upc-name">{c.name}</div>
                          <div className="db-upc-meta">{c.chain}{daysToStart !== null ? ` · Starts in ~${daysToStart}d` : ''}</div>
                        </div>
                        <div className="db-upc-right">
                          {c.pool_usd != null && <div className="db-upc-pool">Est. pool: {fmtUSD(c.pool_usd)}</div>}
                          <div className="db-upc-badge">Upcoming</div>
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
                <div className="db-section-title" style={{ marginTop: 8 }}>Ended</div>
                <div className="db-grid">
                  {filteredEnded.map(c => <CampaignCard key={c.id} campaign={c} />)}
                </div>
              </>
            )}

            {/* Recent activity */}
            <div className="db-activity">
              <div className="db-section-title">Recent activity</div>
              <div className="db-act-list">
                {wallet ? (
                  <div className="db-act-empty">No activity yet — join a campaign and start trading to see your history here.</div>
                ) : (
                  <div className="db-act-empty">Connect your wallet to see recent activity.</div>
                )}
              </div>
            </div>
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

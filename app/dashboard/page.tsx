'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { API, fmtUSD, daysUntil } from '@/lib/web2/api'
import { CampaignCard, Campaign } from '@/components/campaigns/CampaignCard'
import { TokenIcon } from '@/components/TokenIcon'

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
    <>
      <style>{`
        .db-wrap  { background: var(--color-mw-bg); min-height: 100vh; }
        .db-page { padding: 24px 28px 48px; max-width: 1100px; margin: 0 auto; }
        .db-tag  { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--color-mw-live); letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 8px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-tag-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-mw-live); }
        .db-title { font-size: 30px; font-weight: 700; letter-spacing: -0.5px; color: var(--color-mw-ink); line-height: 1.1; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-sub   { font-size: 14px; color: var(--color-mw-ink-3); margin-top: 6px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0 28px; }
        .db-stat  { background: #fff; border-radius: var(--radius-md); padding: 18px 20px; box-shadow: var(--shadow-card); }
        .db-stat-label { font-size: 10px; color: var(--color-mw-ink-3); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600; }
        .db-stat-value { font-size: 30px; font-weight: 700; letter-spacing: -0.8px; color: var(--color-mw-ink); font-family: 'DM Mono', monospace; line-height: 1; }
        .db-stat-sub   { font-size: 11px; margin-top: 6px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-tabs   { display: flex; gap: 4px; margin-bottom: 20px; }
        .db-tab    { padding: 7px 16px; border-radius: var(--radius-xl); font-size: 13px; cursor: pointer; border: none; background: none; color: var(--color-mw-ink-3); font-family: 'Plus Jakarta Sans', sans-serif; transition: background var(--transition-fast), color var(--transition-fast); }
        .db-tab.active { background: var(--color-mw-brand); color: #fff; font-weight: 600; }
        .db-filters { display: flex; gap: 8px; margin-bottom: 20px; align-items: center; flex-wrap: wrap; }
        .db-filter  { padding: 5px 14px; border-radius: var(--radius-xl); font-size: 12px; cursor: pointer; border: 0.5px solid rgba(0,0,0,0.1); background: #fff; color: var(--color-mw-ink-3); font-family: 'Plus Jakarta Sans', sans-serif; display: inline-flex; align-items: center; gap: 4px; }
        .db-filter.active { border-color: var(--color-mw-brand); color: var(--color-mw-brand); background: var(--color-mw-brand-dim); font-weight: 500; }
        .db-filter-count { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: var(--color-mw-brand); color: #fff; font-size: 10px; font-weight: 600; }
        .db-section-title { font-size: 10px; font-weight: 700; color: var(--color-mw-ink-3); margin-bottom: 14px; letter-spacing: 1.2px; text-transform: uppercase; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-grid  { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
        .db-upcoming { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
        .db-upc-row  { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #fff; border: 0.5px dashed rgba(79,126,247,0.25); border-radius: var(--radius-md); cursor: pointer; transition: box-shadow var(--transition-fast), border-color var(--transition-fast); box-shadow: var(--shadow-card); }
        .db-upc-row:hover { border-color: rgba(79,126,247,0.4); box-shadow: var(--shadow-card-hover); }
        .db-upc-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; flex-shrink: 0; border: 0.5px solid var(--color-mw-border); background: var(--color-mw-bg); color: var(--color-mw-ink-3); font-family: 'DM Mono', monospace; }
        .db-upc-name { font-size: 14px; font-weight: 600; color: var(--color-mw-ink); font-family: 'Plus Jakarta Sans', sans-serif; margin-bottom: 3px; }
        .db-upc-meta { font-size: 12px; color: var(--color-mw-ink-3); font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-upc-right { margin-left: auto; text-align: right; flex-shrink: 0; }
        .db-upc-pool  { font-size: 12px; color: var(--color-mw-green); font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600; }
        .db-upc-badge { font-size: 12px; font-weight: 500; color: #f59e0b; font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-activity { margin-top: 28px; }
        .db-act-list { display: flex; flex-direction: column; gap: 6px; }
        .db-act-row  { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #fff; box-shadow: var(--shadow-card); border-radius: 10px; }
        .db-act-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .db-act-text { flex: 1; font-size: 13px; color: var(--color-mw-ink); font-family: 'Plus Jakarta Sans', sans-serif; }
        .db-act-time { font-size: 11px; color: var(--color-mw-ink-5); font-family: 'Plus Jakarta Sans', sans-serif; white-space: nowrap; }
        .db-act-pts  { font-size: 13px; font-weight: 600; color: var(--color-mw-live); font-family: 'DM Mono', monospace; white-space: nowrap; }
        .db-act-empty { padding: 32px 24px; text-align: center; color: var(--color-mw-ink-3); font-size: 13px; font-family: 'Plus Jakarta Sans', sans-serif; border-radius: 10px; background: #fff; box-shadow: var(--shadow-card); }
        .db-skeleton  { background: #fff; border-radius: var(--radius-md); box-shadow: var(--shadow-card); padding: 20px; min-height: 160px; }
        .db-coming-soon { padding: 28px; display: flex; flex-direction: column; justify-content: center; gap: 8px; border: 0.5px dashed rgba(0,0,0,0.12); border-radius: var(--radius-md); opacity: 0.65; }
        @media (max-width: 800px) {
          .db-stats { grid-template-columns: repeat(2, 1fr); }
          .db-grid  { grid-template-columns: 1fr; }
          .db-page  { padding: 20px 16px 40px; }
        }
      `}</style>
      <div className="db-wrap"><div className="db-page">
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '0.5px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 16, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            {error}
          </div>
        )}

        {/* ── Attribution hero ── */}
        <div style={{ background: '#0A0D14', borderRadius: 16, marginBottom: 28, overflow: 'hidden', position: 'relative' }}>
          {/* Blue radial glow */}
          <div style={{ position: 'absolute', top: -40, right: -40, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,126,247,0.14) 0%, transparent 65%)', pointerEvents: 'none' }} />

          <div style={{ display: 'flex', alignItems: 'stretch', position: 'relative' }}>

            {/* Left: Your Attribution score */}
            <div style={{ flex: 1, padding: '32px 32px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-mw-live)', flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-mw-live)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Your Attribution</span>
              </div>

              {wallet ? (
                <>
                  <div style={{ fontSize: 64, fontWeight: 700, color: 'var(--color-mw-brand)', letterSpacing: -3, lineHeight: 1, fontFamily: 'DM Mono, monospace', marginBottom: 12 }}>
                    {userScore !== null ? userScore : <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>}
                    <span style={{ fontSize: 20, fontWeight: 500, color: 'rgba(255,255,255,0.22)', marginLeft: 10, letterSpacing: 0 }}>pts</span>
                  </div>
                  {userTier && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(79,126,247,0.14)', border: '0.5px solid rgba(79,126,247,0.28)', borderRadius: 20, padding: '4px 12px', marginBottom: 14 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#6b9fff', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{userTier} tier</span>
                      {userPercentile !== null && (
                        <span style={{ fontSize: 11, color: 'rgba(107,159,255,0.55)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>· top {100 - userPercentile}%</span>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.32)', lineHeight: 1.6, maxWidth: 260, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                    Your score determines your share of every active campaign pool.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 64, fontWeight: 700, color: 'rgba(255,255,255,0.08)', letterSpacing: -3, lineHeight: 1, fontFamily: 'DM Mono, monospace', marginBottom: 12 }}>—</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.32)', lineHeight: 1.6, maxWidth: 260, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                    Connect your wallet to see your Attribution score and campaign eligibility.
                  </div>
                </>
              )}
            </div>

            {/* Vertical divider */}
            <div style={{ width: '0.5px', background: 'rgba(255,255,255,0.06)', flexShrink: 0, alignSelf: 'stretch' }} />

            {/* Right: Active campaign stats */}
            <div style={{ flex: 1, padding: '32px 32px 28px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 20, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                Active campaigns
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 28px' }}>
                {([
                  { val: totalPool > 0   ? fmtUSD(totalPool)   : '—', lbl: 'Total pool',   color: '#4ade80' },
                  { val: totalDaily > 0  ? fmtUSD(totalDaily)  : '—', lbl: 'Daily payout', color: '#4ade80' },
                  { val: liveCount > 0   ? String(liveCount)   : '—', lbl: 'Live now',      color: '#ffffff' },
                  { val: minScore !== null ? `${minScore}+`    : '—', lbl: 'Min score',     color: '#60a5fa' },
                ] as const).map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: s.color, letterSpacing: -1, lineHeight: 1, fontFamily: 'DM Mono, monospace' }}>{s.val}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 6, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{s.lbl}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div className="db-tabs" style={{ marginBottom: 0 }}>
            <button className={`db-tab${activeTab === 'explore' ? ' active' : ''}`} onClick={() => setActiveTab('explore')}>Explore</button>
            <button className={`db-tab${activeTab === 'mine'    ? ' active' : ''}`} onClick={() => setActiveTab('mine')}>My Campaigns</button>
          </div>
          <Link href="/create-campaign" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--color-mw-brand)', color: '#fff',
            fontSize: 13, fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif',
            padding: '7px 16px', borderRadius: 'var(--radius-xl)',
            textDecoration: 'none', flexShrink: 0,
            transition: 'opacity var(--transition-fast)',
          }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.opacity = '0.85'}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.opacity = '1'}
          >
            + Create campaign
          </Link>
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
                    const daysToStart = c.start_date ? daysUntil(c.start_date) : null
                    return (
                      <div key={c.id} className="db-upc-row">
                        <TokenIcon
                          tokenAddress={c.token_contract}
                          chain={c.chain_id ?? c.chain}
                          name={c.protocol ?? c.name}
                          size={44}
                          borderRadius={10}
                        />
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
      </div></div>
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

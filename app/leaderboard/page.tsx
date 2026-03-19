'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
import { API, fmtUSD, shortAddr, daysUntil } from '@/lib/api'
import { generateRefCode } from '@/lib/referral/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Campaign {
  id: string
  name: string
  status: string
  end_date?: string
  pool_usd?: number
  daily_payout_usd?: number
  actions?: Record<string, { label: string; points: number; per_day?: boolean; per_referral?: boolean; per_referred_trade?: boolean }>
}

interface LeaderboardEntry {
  wallet: string
  total_points?: number
  total_earned_usd?: number
  attribution_score?: number
  referral_bridge_points?: number
  referral_trade_points?: number
}

// ─── Leaderboard Content ──────────────────────────────────────────────────────
function LeaderboardContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''

  const [campaigns, setCampaigns]             = useState<Campaign[]>([])
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null)
  const [allEntries, setAllEntries]           = useState<LeaderboardEntry[]>([])
  const [sortBy, setSortBy]                   = useState<'points' | 'score' | 'referrals'>('points')
  const [loading, setLoading]                 = useState(false)
  const [lbSubText, setLbSubText]             = useState('Loading…')
  const [linkCopied, setLinkCopied]           = useState(false)

  const refCode = wallet ? generateRefCode(wallet) : ''
  const refLink = wallet ? `https://mintware.app?ref=${refCode}` : ''

  function copyLink() {
    if (!refLink) return
    navigator.clipboard.writeText(refLink).catch(() => {})
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  useEffect(() => {
    async function load() {
      try {
        const res  = await fetch(`${API}/campaigns`)
        const data = await res.json()
        if (!Array.isArray(data) || data.length === 0) return
        setCampaigns(data)
        setActiveCampaignId(data[0].id)
      } catch {
        setLbSubText('Failed to load campaigns')
      }
    }
    load()
  }, [])

  const loadLeaderboard = useCallback(async () => {
    if (!activeCampaignId) return
    setLoading(true)
    setAllEntries([])
    try {
      const res  = await fetch(`${API}/leaderboard?campaign_id=${encodeURIComponent(activeCampaignId)}&limit=100`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('Bad response')
      setAllEntries(data)
      const campaign = campaigns.find(c => c.id === activeCampaignId)
      setLbSubText(`${data.length} participant${data.length !== 1 ? 's' : ''} · ${campaign?.name ?? ''} · Live`)
    } catch {
      setLbSubText('Error loading data')
    } finally {
      setLoading(false)
    }
  }, [activeCampaignId, campaigns])

  useEffect(() => { loadLeaderboard() }, [loadLeaderboard])

  function getSorted(): LeaderboardEntry[] {
    const list = [...allEntries]
    if (sortBy === 'score')    list.sort((a, b) => (b.attribution_score || 0) - (a.attribution_score || 0))
    if (sortBy === 'points')   list.sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
    if (sortBy === 'referrals') list.sort((a, b) => {
      const ra = (a.referral_bridge_points || 0) + (a.referral_trade_points || 0)
      const rb = (b.referral_bridge_points || 0) + (b.referral_trade_points || 0)
      return rb - ra
    })
    return list
  }

  const sorted    = getSorted()
  const total     = sorted.length
  const myIdx     = wallet ? sorted.findIndex(r => r.wallet === wallet) : -1
  const me        = myIdx >= 0 ? sorted[myIdx] : null
  const top10     = sorted.slice(0, 10)
  const showUser  = myIdx >= 10
  const userCtx   = showUser ? sorted.slice(Math.max(10, myIdx - 1), myIdx + 2) : []

  const activeCampaign = campaigns.find(c => c.id === activeCampaignId)
  const daysLeft       = activeCampaign?.end_date ? daysUntil(activeCampaign.end_date) : null

  const myRefPts = me ? ((me.referral_bridge_points || 0) + (me.referral_trade_points || 0)) : 0
  const topPct   = (me && total > 0) ? (100 - Math.round(((total - (myIdx + 1)) / total) * 100)) : null

  function buildRow(entry: LeaderboardEntry, rank: number, isMe: boolean) {
    const RANK_COLORS: Record<number, string> = { 1: '#f59e0b', 2: '#9ca3af', 3: '#d97706' }
    const rankColor = RANK_COLORS[rank] ?? '#6b7280'
    return (
      <tr
        key={entry.wallet + rank}
        style={{
          background: isMe ? 'rgba(79,126,247,0.05)' : undefined,
          cursor: 'pointer',
        }}
        className={isMe ? 'lb-row-me' : 'lb-row'}
      >
        <td className="lb-td lb-rank" style={{ color: rank <= 3 ? rankColor : '#9ca3af', fontWeight: rank <= 3 ? 700 : 500 }}>
          {rank}
        </td>
        <td className="lb-td">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'rgba(79,126,247,0.12)', color: '#4f7ef7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, flexShrink: 0,
              fontFamily: 'DM Mono, monospace',
            }}>
              {entry.wallet.charAt(2).toUpperCase()}
            </div>
            <span style={{ fontSize: 13, fontWeight: 500, fontFamily: 'DM Mono, monospace' }}>
              {shortAddr(entry.wallet)}
              {isMe && <span style={{ fontSize: 11, color: '#22c55e', marginLeft: 6 }}>(you)</span>}
            </span>
          </div>
        </td>
        <td className="lb-td lb-right" style={{ fontWeight: 600, color: '#4f7ef7', fontFamily: 'DM Mono, monospace' }}>
          {entry.attribution_score || 0}
        </td>
        <td className="lb-td lb-right" style={{ fontWeight: 600, color: '#22c55e', fontFamily: 'DM Mono, monospace' }}>
          {fmtUSD(entry.total_earned_usd || 0)}
        </td>
        <td className="lb-td lb-right lb-pts-col" style={{ fontWeight: 500, color: '#1a1a1a', fontFamily: 'DM Mono, monospace' }}>
          {(entry.total_points || 0).toLocaleString()}
        </td>
      </tr>
    )
  }

  return (
    <>
      <style>{`
        .lb-layout { display: flex; align-items: flex-start; }
        .lb-main { flex: 1; padding: 28px 28px 40px; min-width: 0; }
        .lb-sidebar { width: 300px; flex-shrink: 0; padding: 28px 20px; border-left: 0.5px solid rgba(0,0,0,0.07); }

        .lb-page-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; color: #4f7ef7; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 10px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-title    { font-size: 28px; font-weight: 600; letter-spacing: -0.5px; color: #1a1a1a; margin-bottom: 6px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-sub      { font-size: 14px; color: #6b7280; margin-bottom: 24px; font-family: 'Plus Jakarta Sans', sans-serif; }

        .lb-campaign-selector { display: flex; gap: 8px; margin-bottom: 24px; align-items: center; flex-wrap: wrap; }
        .lb-cs-label { font-size: 12px; color: #6b7280; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-cs-btn { padding: 7px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; background: #1a1a1a; color: #fff; border: none; cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-cs-btn.inactive { background: #fff; color: #6b7280; border: 0.5px solid rgba(0,0,0,0.12); font-weight: 500; }
        .lb-cs-btn.inactive:hover { border-color: #4f7ef7; color: #4f7ef7; background: rgba(79,126,247,0.06); }

        .lb-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
        .lb-stat  { background: #f9f9fb; border-radius: 12px; padding: 16px 18px; border: 0.5px solid rgba(0,0,0,0.08); }
        .lb-stat-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-stat-value { font-size: 22px; font-weight: 600; letter-spacing: -0.5px; color: #1a1a1a; font-family: 'DM Mono', monospace; }
        .lb-stat-sub   { font-size: 11px; color: #6b7280; margin-top: 2px; font-family: 'Plus Jakarta Sans', sans-serif; }

        .lb-card { background: #fff; border: 0.5px solid rgba(0,0,0,0.09); border-radius: 12px; overflow: hidden; }
        .lb-card-header { padding: 16px 20px; border-bottom: 0.5px solid rgba(0,0,0,0.07); display: flex; align-items: center; justify-content: space-between; }
        .lb-card-title  { font-size: 15px; font-weight: 600; color: #1a1a1a; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-card-meta   { font-size: 12px; color: #6b7280; font-family: 'Plus Jakarta Sans', sans-serif; }

        .lb-tabs { display: flex; border-bottom: 0.5px solid rgba(0,0,0,0.07); }
        .lb-tab  { padding: 10px 16px; font-size: 13px; cursor: pointer; color: #6b7280; border: none; background: none; border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: 'Plus Jakarta Sans', sans-serif; transition: color 0.15s; }
        .lb-tab.active { color: #4f7ef7; border-bottom-color: #4f7ef7; font-weight: 500; }
        .lb-tab:hover:not(.active) { color: #1a1a1a; }

        .lb-table { width: 100%; border-collapse: collapse; }
        .lb-table th { padding: 12px 16px; font-size: 11px; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; text-align: left; border-bottom: 0.5px solid rgba(0,0,0,0.07); background: #f9f9fb; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-table th:not(:first-child) { text-align: right; }
        .lb-td { padding: 14px 16px; font-size: 13px; border-bottom: 0.5px solid rgba(0,0,0,0.05); }
        .lb-rank { font-weight: 600; font-size: 14px; width: 48px; text-align: center !important; }
        .lb-right { text-align: right; }
        .lb-pts-col { }
        .lb-row:hover .lb-td { background: #f9f9fb; }
        .lb-row-me .lb-td { background: rgba(79,126,247,0.05); }
        .lb-row-me:hover .lb-td { background: rgba(79,126,247,0.08); }
        .lb-table tr:last-child .lb-td { border-bottom: none; }
        .lb-separator .lb-td { text-align: center; color: #9ca3af; font-size: 11px; letter-spacing: 3px; padding: 8px; border-bottom: 0.5px solid rgba(0,0,0,0.05); }

        .lb-skeleton { height: 44px; border-radius: 8px; background: #f0f0f2; margin-bottom: 8px; }

        /* Sidebar */
        .lb-your-rank { background: rgba(79,126,247,0.06); border: 0.5px solid rgba(79,126,247,0.2); border-radius: 12px; padding: 16px; margin-bottom: 20px; }
        .lb-yr-label  { font-size: 11px; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 10px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-yr-rank   { font-size: 32px; font-weight: 700; letter-spacing: -1px; color: #1a1a1a; margin-bottom: 4px; font-family: 'DM Mono', monospace; }
        .lb-yr-sub    { font-size: 12px; color: #6b7280; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-yr-stats  { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
        .lb-yr-stat   { background: #fff; border-radius: 8px; padding: 10px; border: 0.5px solid rgba(0,0,0,0.08); }
        .lb-yr-stat-val   { font-size: 16px; font-weight: 600; color: #1a1a1a; font-family: 'DM Mono', monospace; }
        .lb-yr-stat-label { font-size: 11px; color: #6b7280; margin-top: 2px; font-family: 'Plus Jakarta Sans', sans-serif; }

        .lb-hte { margin-top: 20px; }
        .lb-hte-title { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 12px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-hte-item  { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 0.5px solid rgba(0,0,0,0.06); }
        .lb-hte-item:last-child { border-bottom: none; }
        .lb-hte-dot   { width: 8px; height: 8px; border-radius: 50%; background: #4f7ef7; flex-shrink: 0; }
        .lb-hte-text  { flex: 1; font-size: 12px; color: #6b7280; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-hte-pts   { font-size: 12px; font-weight: 700; color: #4f7ef7; font-family: 'DM Mono', monospace; }

        .lb-invite { margin-top: 20px; }
        .lb-invite-card { background: #f9f9fb; border-radius: 10px; padding: 14px; border: 0.5px solid rgba(0,0,0,0.08); }
        .lb-invite-title { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-invite-sub   { font-size: 12px; color: #6b7280; margin-bottom: 12px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .lb-invite-link  { background: #fff; border: 0.5px solid rgba(0,0,0,0.12); border-radius: 8px; padding: 9px 12px; font-size: 11px; font-family: 'DM Mono', monospace; color: #6b7280; display: flex; align-items: center; justify-content: space-between; }
        .lb-copy-btn { font-size: 11px; color: #4f7ef7; cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif; background: none; border: none; }

        @media (max-width: 820px) {
          .lb-layout { flex-direction: column; }
          .lb-sidebar { width: 100%; border-left: none; border-top: 0.5px solid rgba(0,0,0,0.07); padding: 20px; }
          .lb-main { padding: 20px 16px; }
          .lb-stats { grid-template-columns: 1fr 1fr; }
          .lb-pts-col { display: none; }
        }
      `}</style>

      <div className="lb-layout">
        {/* ── Main column ── */}
        <div className="lb-main">
          <div className="lb-page-tag">🏆 LEADERBOARD</div>
          <div className="lb-title">Rankings</div>
          <div className="lb-sub">Top participants ranked by points, attribution score, and referral activity.</div>

          {/* Campaign selector */}
          <div className="lb-campaign-selector">
            <span className="lb-cs-label">Campaign</span>
            {campaigns.length === 0
              ? <button className="lb-cs-btn inactive" disabled>Loading…</button>
              : campaigns.map(c => (
                <button
                  key={c.id}
                  className={`lb-cs-btn${c.id !== activeCampaignId ? ' inactive' : ''}`}
                  onClick={() => setActiveCampaignId(c.id)}
                >
                  {c.name}
                </button>
              ))}
          </div>

          {/* Stats row */}
          <div className="lb-stats">
            <div className="lb-stat">
              <div className="lb-stat-label">Total participants</div>
              <div className="lb-stat-value">{loading ? '—' : total}</div>
              <div className="lb-stat-sub">{total === 0 ? 'Be the first to join' : `Ranked wallets`}</div>
            </div>
            <div className="lb-stat">
              <div className="lb-stat-label">Pool remaining</div>
              <div className="lb-stat-value">{activeCampaign?.pool_usd != null ? fmtUSD(activeCampaign.pool_usd) : '—'}</div>
              <div className="lb-stat-sub">{daysLeft !== null ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left` : ''}</div>
            </div>
            <div className="lb-stat">
              <div className="lb-stat-label">Daily payout</div>
              <div className="lb-stat-value">{activeCampaign?.daily_payout_usd != null ? fmtUSD(activeCampaign.daily_payout_usd) : '—'}</div>
              <div className="lb-stat-sub">distributed to earners</div>
            </div>
          </div>

          {/* Table card */}
          <div className="lb-card">
            <div className="lb-card-header">
              <div className="lb-card-title">Campaign leaderboard</div>
              <div className="lb-card-meta">Updates every 5 min</div>
            </div>

            {/* Sort tabs */}
            <div className="lb-tabs">
              {(['points', 'score', 'referrals'] as const).map(tab => (
                <button
                  key={tab}
                  className={`lb-tab${sortBy === tab ? ' active' : ''}`}
                  onClick={() => setSortBy(tab)}
                >
                  {tab === 'points' ? 'Top earners' : tab === 'score' ? 'Top score' : 'Top referrers'}
                </button>
              ))}
            </div>

            <table className="lb-table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th style={{ textAlign: 'left' }}>Wallet</th>
                  <th>Score</th>
                  <th>Earned</th>
                  <th className="lb-pts-col">Points</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '16px 20px' }}>
                      {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="lb-skeleton" />
                      ))}
                    </td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '48px 20px', textAlign: 'center', color: '#6b7280', fontSize: 14, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                      No participants yet — be the first!
                      <span style={{ fontSize: 12, display: 'block', marginTop: 6, color: '#9ca3af' }}>
                        Trade on {activeCampaign?.name ?? 'the campaign'} to appear here.
                      </span>
                    </td>
                  </tr>
                ) : (
                  <>
                    {top10.map((entry, i) => buildRow(entry, i + 1, !!(wallet && entry.wallet === wallet)))}
                    {showUser && (
                      <>
                        <tr className="lb-separator">
                          <td colSpan={5} className="lb-td">· · ·</td>
                        </tr>
                        {userCtx.map((entry, i) => {
                          const rank = Math.max(11, myIdx) - 1 + i + 1
                          return buildRow(entry, rank, !!(wallet && entry.wallet === wallet))
                        })}
                      </>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="lb-sidebar">
          {/* Your standing card */}
          <div className="lb-your-rank">
            <div className="lb-yr-label">Your standing</div>
            {me ? (
              <>
                <div className="lb-yr-rank">#{myIdx + 1}</div>
                <div className="lb-yr-sub">Top {topPct}% · {total} total participants</div>
                <div className="lb-yr-stats">
                  <div className="lb-yr-stat">
                    <div className="lb-yr-stat-val">{(me.total_points || 0).toLocaleString()}</div>
                    <div className="lb-yr-stat-label">Points</div>
                  </div>
                  <div className="lb-yr-stat">
                    <div className="lb-yr-stat-val">{me.attribution_score || 0}</div>
                    <div className="lb-yr-stat-label">Score</div>
                  </div>
                  <div className="lb-yr-stat">
                    <div className="lb-yr-stat-val" style={{ color: '#22c55e' }}>{fmtUSD(me.total_earned_usd || 0)}</div>
                    <div className="lb-yr-stat-label">Earned</div>
                  </div>
                  <div className="lb-yr-stat">
                    <div className="lb-yr-stat-val">{myRefPts}</div>
                    <div className="lb-yr-stat-label">Ref pts</div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="lb-yr-rank" style={{ color: '#9ca3af' }}>—</div>
                <div className="lb-yr-sub">{wallet ? 'No rank yet · start trading to qualify' : 'Connect wallet to see your rank'}</div>
                <div className="lb-yr-stats">
                  {['Points', 'Score', 'Earned', 'Referrals'].map(l => (
                    <div key={l} className="lb-yr-stat">
                      <div className="lb-yr-stat-val" style={{ color: '#9ca3af' }}>0</div>
                      <div className="lb-yr-stat-label">{l}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* How to earn */}
          {activeCampaign?.actions && Object.keys(activeCampaign.actions).length > 0 && (
            <div className="lb-hte">
              <div className="lb-hte-title">How to earn points</div>
              {Object.entries(activeCampaign.actions).map(([key, action]) => {
                const suffix = action.per_day ? '/day' : action.per_referral ? '/ref' : action.per_referred_trade ? '/trade' : ''
                const dotColors: Record<string, string> = {
                  trade: '#2A9E8A',
                  bridge: '#4f7ef7',
                  hold: '#C27A00',
                }
                const dotColor = key.startsWith('referral') ? '#7B6FCC' : (dotColors[key] ?? '#4f7ef7')
                return (
                  <div key={key} className="lb-hte-item">
                    <div className="lb-hte-dot" style={{ background: dotColor }} />
                    <div className="lb-hte-text">{action.label}</div>
                    <div className="lb-hte-pts">+{action.points}{suffix}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Invite */}
          {wallet && (
            <div className="lb-invite">
              <div className="lb-invite-card">
                <div className="lb-invite-title">Invite friends</div>
                <div className="lb-invite-sub">Share your link to earn points for every referred trade</div>
                <div className="lb-invite-link" style={{ marginBottom: 6 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>{refLink}</span>
                  <button className="lb-copy-btn" onClick={copyLink}>
                    {linkCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  Your code: <span style={{ fontFamily: 'DM Mono, monospace', color: '#4f7ef7' }}>{refCode}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  return (
    <>
      <MwNav />
      <MwAuthGuard>
        <LeaderboardContent />
      </MwAuthGuard>
    </>
  )
}

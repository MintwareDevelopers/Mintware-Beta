'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
import { API, fmtUSD, shortAddr } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Campaign {
  id: string
  name: string
  status: string
}

interface LeaderboardEntry {
  wallet: string
  total_points?: number
  total_earned_usd?: number
  attribution_score?: number
  referral_bridge_points?: number
  referral_trade_points?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const AVATAR_BG = ['#fff8f0','#f0f4ff','#f0fff4','#fff0f8','#f5f0ff','#fffbf0','#f0f8ff','#fff5f0']
function avatarBg(addr: string) {
  let h = 0; for (const c of addr) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_BG[h % AVATAR_BG.length]
}

// ─── Leaderboard Content ──────────────────────────────────────────────────────
function LeaderboardContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null)
  const [allEntries, setAllEntries] = useState<LeaderboardEntry[]>([])
  const [sortBy, setSortBy] = useState<'points' | 'score' | 'referrals'>('points')
  const [loading, setLoading] = useState(false)
  const [lbSubText, setLbSubText] = useState('Loading…')

  // Load campaigns
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/campaigns`)
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

  // Load leaderboard whenever activeCampaignId changes
  const loadLeaderboard = useCallback(async () => {
    if (!activeCampaignId) return
    setLoading(true)
    setAllEntries([])
    try {
      const res = await fetch(`${API}/leaderboard?campaign_id=${encodeURIComponent(activeCampaignId)}&limit=100`)
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
    if (sortBy === 'score') list.sort((a, b) => (b.attribution_score || 0) - (a.attribution_score || 0))
    if (sortBy === 'points') list.sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
    if (sortBy === 'referrals') list.sort((a, b) => {
      const ra = (a.referral_bridge_points || 0) + (a.referral_trade_points || 0)
      const rb = (b.referral_bridge_points || 0) + (b.referral_trade_points || 0)
      return rb - ra
    })
    return list
  }

  const sorted = getSorted()
  const total = sorted.length
  const myIdx = wallet ? sorted.findIndex(r => r.wallet === wallet) : -1
  const me = myIdx >= 0 ? sorted[myIdx] : null
  const top10 = sorted.slice(0, 10)
  const showUser = myIdx >= 10
  const userCtx = showUser ? sorted.slice(Math.max(10, myIdx - 1), myIdx + 2) : []

  function buildRow(entry: LeaderboardEntry, rank: number, isMe: boolean) {
    return (
      <div key={entry.wallet + rank} className={`lb-row${isMe ? ' my-row' : ''}`}>
        <div className={`lb-col-rank${rank <= 3 ? ' top3' : ''}`}>{rank}</div>
        <div className="lb-col-identity">
          <div className="lb-row-avatar" style={{background:avatarBg(entry.wallet)}}>
            {entry.wallet.charAt(2).toUpperCase()}
          </div>
          <div className="lb-row-addr">
            {shortAddr(entry.wallet)}
            {isMe && <span className="you-tag">you</span>}
          </div>
        </div>
        <div className="lb-col-score">{entry.attribution_score || 0}</div>
        <div className="lb-col-earnings">{fmtUSD(entry.total_earned_usd || 0)}</div>
        <div className="lb-col-pts">{(entry.total_points || 0).toLocaleString()}</div>
      </div>
    )
  }

  return (
    <div className="page">
      {/* Campaign selector */}
      <div className="campaign-select-wrap">
        <span className="campaign-select-label">Campaign</span>
        <div className="campaign-select-row">
          {campaigns.length === 0
            ? <div className="campaign-pill active" style={{opacity:0.5}}>Loading campaigns…</div>
            : campaigns.map(c => (
              <button
                key={c.id}
                className={`campaign-pill${c.id === activeCampaignId ? ' active' : ''}`}
                onClick={() => setActiveCampaignId(c.id)}
              >
                {c.name}
              </button>
            ))}
        </div>
      </div>

      {/* Your rank banner */}
      {me && (
        <div className="your-rank-banner">
          <div>
            <div className="yr-label">Your rank</div>
            <div className="yr-rank-num">#{myIdx + 1}</div>
          </div>
          <div className="yr-divider" />
          <div className="yr-meta">
            <div className="yr-label">Points</div>
            <div style={{fontSize:20,fontWeight:700,fontFamily:'var(--font-mono),DM Mono,monospace'}}>
              {(me.total_points || 0).toLocaleString()} pts
            </div>
          </div>
          <div className="yr-bar-wrap">
            <div className="yr-bar">
              <div className="yr-bar-fill" style={{width: Math.max(2, Math.round(((total - (myIdx+1)) / total) * 100)) + '%'}} />
            </div>
            <div className="yr-bar-labels">
              <span>#1</span>
              <span>#{myIdx + 1} · top {100 - Math.round(((total - (myIdx+1)) / total) * 100)}%</span>
            </div>
          </div>
          <div className="yr-score-box">
            <div className="yr-score-label">Earned</div>
            <div className="yr-score-val">{fmtUSD(me.total_earned_usd || 0)}</div>
          </div>
        </div>
      )}

      {/* Main leaderboard card */}
      <div className="lb-card">
        <div className="lb-header">
          <div className="lb-title">Campaign leaderboard</div>
          <div className="lb-sub">{lbSubText}</div>
          <div className="lb-tabs">
            {(['points','score','referrals'] as const).map(tab => (
              <div
                key={tab}
                className={`lb-tab${sortBy === tab ? ' active' : ''}`}
                onClick={() => setSortBy(tab)}
              >
                {tab === 'points' ? 'Top earners' : tab === 'score' ? 'Top score' : 'Top referrers'}
              </div>
            ))}
          </div>
        </div>
        <div className="lb-body">
          {/* Podium */}
          {sorted.length >= 3 && !loading && (
            <div className="lb-podium">
              {[sorted[1], sorted[0], sorted[2]].map((entry, i) => {
                const medals = ['🥈','🥇','🥉']
                const podClasses = ['lb-pod-2','lb-pod-1','lb-pod-3']
                const isMe = wallet && entry.wallet === wallet
                const val = sortBy === 'score' ? (entry.attribution_score || 0) : (entry.total_points || 0)
                const valLabel = sortBy === 'score' ? 'score' : 'pts'
                return (
                  <div key={entry.wallet + i} className={`lb-pod ${podClasses[i]}${isMe ? ' you-pod' : ''}`}>
                    <div className="lb-pod-rank">{medals[i]}</div>
                    <div className="lb-pod-avatar" style={{background:avatarBg(entry.wallet)}}>
                      {entry.wallet.charAt(2).toUpperCase()}
                    </div>
                    <div className="lb-pod-addr">
                      {shortAddr(entry.wallet)}{isMe && <span className="you-tag">you</span>}
                    </div>
                    <div className="lb-pod-score">{val.toLocaleString()}</div>
                    <div className="lb-pod-score-label">{valLabel}</div>
                    <div className="lb-pod-earnings">{fmtUSD(entry.total_earned_usd || 0)} earned</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Table */}
          <div className="lb-table-header">
            <div>#</div><div>Wallet</div><div>Score</div><div>Earned</div><div>Points</div>
          </div>
          <div id="lb-table">
            {loading ? (
              <div className="lb-skeleton">
                {[1,2,3,4,5].map(i => <div key={i} className="sk-row" />)}
              </div>
            ) : sorted.length === 0 ? (
              <div className="lb-empty">No participants yet — be the first!</div>
            ) : (
              <>
                {top10.map((entry, i) => buildRow(entry, i + 1, !!(wallet && entry.wallet === wallet)))}
                {showUser && (
                  <>
                    <div className="lb-sep">· · ·</div>
                    {userCtx.map((entry, i) => {
                      const rank = Math.max(11, myIdx) - 1 + i + 1
                      return buildRow(entry, rank, !!(wallet && entry.wallet === wallet))
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  return (
    <>
      <style>{`
        :root{
          --blue:#0052FF;--blue-dim:rgba(0,82,255,0.07);
          --ink:#1A1A2E;--ink-2:#3A3C52;--ink-3:#8A8C9E;
          --surface:#F7F6FF;--white:#ffffff;
          --green:#16a34a;--green-bg:#f0fdf4;--green-border:#bbf7d0;
          --border:rgba(26,26,46,0.08);--border-strong:rgba(26,26,46,0.13);
          --shadow-md:0 4px 16px rgba(26,26,46,0.08);
        }
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;background:var(--surface);color:var(--ink);min-height:100vh}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{to{left:150%}}
        .page{max-width:960px;margin:0 auto;padding:40px 48px 80px}
        .campaign-select-wrap{margin-bottom:28px;animation:fadeUp 0.4s ease both}
        .campaign-select-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px;display:block}
        .campaign-select-row{display:flex;gap:8px;flex-wrap:wrap}
        .campaign-pill{padding:6px 16px;border-radius:20px;border:1px solid var(--border-strong);background:var(--white);color:var(--ink-3);font-size:13px;font-weight:500;cursor:pointer;transition:all 0.15s;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif}
        .campaign-pill:hover{border-color:var(--blue);color:var(--blue)}
        .campaign-pill.active{background:var(--ink);color:white;border-color:var(--ink)}
        .your-rank-banner{background:var(--blue);border-radius:16px;padding:20px 24px;display:flex;align-items:center;gap:20px;margin-bottom:16px;animation:fadeUp 0.45s 0.05s ease both;color:white}
        .yr-rank-num{font-family:Georgia,serif;font-size:36px;font-weight:700;letter-spacing:-1px;line-height:1;flex-shrink:0}
        .yr-divider{width:1px;background:rgba(255,255,255,0.15);align-self:stretch}
        .yr-meta{flex:1}
        .yr-label{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:4px}
        .yr-bar-wrap{flex:1;min-width:0}
        .yr-bar{height:4px;background:rgba(255,255,255,0.15);border-radius:2px;overflow:hidden;margin-bottom:6px}
        .yr-bar-fill{height:100%;background:rgba(255,255,255,0.7);border-radius:2px;transition:width 0.8s cubic-bezier(0.22,1,0.36,1)}
        .yr-bar-labels{display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,0.35)}
        .yr-score-box{text-align:right;flex-shrink:0}
        .yr-score-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:3px}
        .yr-score-val{font-family:var(--font-mono),'DM Mono',monospace;font-size:22px;font-weight:700;color:white}
        .lb-card{background:var(--white);border:1px solid var(--border);border-radius:20px;overflow:hidden;margin-bottom:16px;animation:fadeUp 0.5s 0.1s ease both}
        .lb-header{padding:20px 24px 0}
        .lb-title{font-size:16px;font-weight:700;color:var(--ink);margin-bottom:2px}
        .lb-sub{font-size:12px;color:var(--ink-3);font-family:var(--font-mono),'DM Mono',monospace;margin-bottom:14px}
        .lb-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin:0 -24px;padding:0 24px}
        .lb-tab{padding:10px 16px;font-size:13px;font-weight:500;color:var(--ink-3);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:all 0.15s}
        .lb-tab:hover{color:var(--ink)}
        .lb-tab.active{color:var(--blue);border-bottom-color:var(--blue);font-weight:600}
        .lb-body{padding:0 24px 24px}
        .lb-podium{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:20px 0;align-items:end}
        .lb-pod{border-radius:12px;padding:16px;text-align:center;cursor:pointer;transition:all 0.15s;border:1px solid var(--border)}
        .lb-pod:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
        .lb-pod-1{background:#fffbf0;border-color:#fde68a;order:2}
        .lb-pod-2{background:#f8f8f8;border-color:#e5e5e5;order:1}
        .lb-pod-3{background:#fff8f5;border-color:#fed7aa;order:3}
        .lb-pod-rank{font-size:22px;margin-bottom:6px}
        .lb-pod-avatar{width:44px;height:44px;border-radius:12px;margin:0 auto 8px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;font-family:var(--font-mono),'DM Mono',monospace;color:var(--ink-2)}
        .lb-pod-addr{font-size:11px;font-weight:700;color:var(--ink);margin-bottom:2px;font-family:var(--font-mono),'DM Mono',monospace}
        .lb-pod-score{font-size:22px;font-weight:700;font-family:var(--font-mono),'DM Mono',monospace;color:var(--ink)}
        .lb-pod-score-label{font-size:10px;color:var(--ink-3);margin-top:1px}
        .lb-pod-earnings{font-size:11px;color:var(--green);font-weight:600;margin-top:6px;background:var(--green-bg);padding:3px 8px;border-radius:20px;display:inline-block}
        .lb-pod.you-pod{outline:2px solid var(--blue);outline-offset:2px}
        .lb-table-header{display:grid;grid-template-columns:44px 1fr 90px 100px 80px;gap:0;padding:10px 0 6px;border-bottom:1px solid var(--border)}
        .lb-table-header div{font-size:10px;font-weight:700;color:var(--ink-3);text-align:right;letter-spacing:0.5px;text-transform:uppercase}
        .lb-table-header div:first-child{text-align:center}
        .lb-table-header div:nth-child(2){text-align:left}
        .lb-row{display:grid;grid-template-columns:44px 1fr 90px 100px 80px;gap:0;align-items:center;padding:11px 0;border-bottom:1px solid rgba(26,26,46,0.04);cursor:pointer;transition:background 0.1s;border-radius:8px}
        .lb-row:hover{background:var(--surface);margin:0 -8px;padding:11px 8px}
        .lb-row.my-row{background:var(--blue-dim);margin:0 -8px;padding:11px 8px;border-left:2px solid var(--blue);border-radius:0}
        .lb-col-rank{font-size:12px;font-weight:700;color:var(--ink-3);font-family:var(--font-mono),'DM Mono',monospace;text-align:center}
        .lb-col-rank.top3{color:var(--ink)}
        .lb-col-identity{display:flex;align-items:center;gap:10px;min-width:0}
        .lb-row-avatar{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;font-family:var(--font-mono),'DM Mono',monospace;flex-shrink:0;color:var(--ink-2)}
        .lb-row-addr{font-size:12px;font-weight:600;color:var(--ink);font-family:var(--font-mono),'DM Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .you-tag{font-size:9px;font-weight:700;color:var(--blue);background:var(--blue-dim);border:1px solid rgba(0,82,255,0.2);border-radius:8px;padding:1px 6px;margin-left:4px;vertical-align:middle}
        .lb-col-score{font-size:13px;font-weight:700;color:var(--blue);font-family:var(--font-mono),'DM Mono',monospace;text-align:right}
        .lb-col-earnings{font-size:13px;font-weight:600;color:var(--green);text-align:right}
        .lb-col-pts{font-size:12px;color:var(--ink-3);text-align:right;font-family:var(--font-mono),'DM Mono',monospace}
        .lb-sep{padding:10px 0;text-align:center;font-size:11px;color:var(--ink-3);letter-spacing:3px;border-bottom:1px solid var(--border)}
        .lb-skeleton{padding:20px 0}
        .sk-row{height:44px;border-radius:8px;background:var(--border);margin-bottom:8px;position:relative;overflow:hidden}
        .sk-row::after{content:'';position:absolute;top:0;left:-150%;width:150%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.5),transparent);animation:shimmer 1.4s infinite}
        .lb-empty{text-align:center;padding:48px 24px;color:var(--ink-3);font-size:14px}
        @media(max-width:640px){
          .page{padding:24px 20px 60px}
          .lb-podium{grid-template-columns:1fr}
          .lb-pod{order:unset!important}
          .lb-table-header,.lb-row{grid-template-columns:36px 1fr 70px 80px}
          .lb-col-pts,.lb-table-header div:last-child{display:none}
        }
      `}</style>
      <MwNav />
      <MwAuthGuard>
        <LeaderboardContent />
      </MwAuthGuard>
    </>
  )
}

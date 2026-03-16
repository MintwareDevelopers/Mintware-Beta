'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { API, fmtUSD, daysUntil, shortAddr, iconColor } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Campaign {
  id: string
  name: string
  chain: string
  status: string
  end_date?: string
  pool_usd?: number
  daily_payout_usd?: number
  token_symbol?: string
  min_score?: number
  protocol?: string
  actions?: Record<string, {
    label: string; points: number
    per_day?: boolean; one_time?: boolean
    per_referral?: boolean; per_referred_trade?: boolean
  }>
}

interface Participant {
  attribution_score: number
  score_multiplier: string
  total_points: number
  total_earned_usd: string
  bridge_points?: number
  trading_points?: number
  referral_bridge_points?: number
  referral_trade_points?: number
  active_trading_days?: number
}

interface LbEntry {
  wallet: string
  total_points?: number
  total_earned_usd?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function actionMeta(key: string): { icon: string; bg: string; desc: string } {
  const map: Record<string, { icon: string; bg: string; desc: string }> = {
    bridge:          { icon:'🌉', bg:'var(--blue-dim)',       desc:'Bridge assets to this chain. One-time action.' },
    trade:           { icon:'📈', bg:'var(--green-bg)',       desc:'Trade each day to earn points. Repeatable daily.' },
    referral_bridge: { icon:'🔗', bg:'rgba(124,58,237,0.08)', desc:'Share your bridge link. Earn when they bridge.' },
    referral_trade:  { icon:'↗',  bg:'rgba(194,83,122,0.08)', desc:'Earn every time your referral trades.' },
  }
  return map[key] || { icon:'⚡', bg:'var(--surface)', desc:'' }
}

const avatarColors = [
  { bg:'rgba(180,83,9,0.1)',    fg:'#B45309' },
  { bg:'rgba(26,26,46,0.06)',   fg:'var(--ink-2)' },
  { bg:'rgba(249,115,22,0.08)', fg:'#f97316' },
]

// ─── Countdown ────────────────────────────────────────────────────────────────
function Countdown({ dailyPayout, tokenSymbol, daysLeft }: { dailyPayout?: number; tokenSymbol?: string; daysLeft: number | null }) {
  const [time, setTime] = useState({ h:'--', m:'--', s:'--', pct:0 })

  useEffect(() => {
    function tick() {
      const now = Date.now()
      const next = new Date(Date.UTC(
        new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1
      )).getTime()
      const diff = next - now
      const dayMs = 86400000
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setTime({
        h: String(h).padStart(2,'0'),
        m: String(m).padStart(2,'0'),
        s: String(s).padStart(2,'0'),
        pct: Math.round(((dayMs - diff) / dayMs) * 100),
      })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="side-card" style={{animation:'fadeUp 0.5s 0.14s ease both'}}>
      <div className="side-title">Next payout in</div>
      <div className="time-ring">
        <div className="time-units">
          <div className="time-unit"><div className="time-num">{time.h}</div><div className="time-label">Hours</div></div>
          <div className="time-sep">:</div>
          <div className="time-unit"><div className="time-num">{time.m}</div><div className="time-label">Mins</div></div>
          <div className="time-sep">:</div>
          <div className="time-unit"><div className="time-num">{time.s}</div><div className="time-label">Secs</div></div>
        </div>
      </div>
      <div className="time-bar"><div className="time-fill" style={{width:time.pct+'%'}} /></div>
      <div style={{fontSize:11,color:'var(--ink-3)',textAlign:'center',marginTop:10}}>
        {fmtUSD(dailyPayout)} {tokenSymbol} distributes · {daysLeft !== null ? daysLeft + ' days left' : 'ongoing'}
      </div>
    </div>
  )
}

// ─── Campaign Content ─────────────────────────────────────────────────────────
function CampaignContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const params = useParams()
  const campaignId = params.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [leaderboard, setLeaderboard] = useState<LbEntry[]>([])
  const [loadError, setLoadError] = useState(false)
  const [joining, setJoining] = useState(false)

  // Load campaign data
  const loadCampaign = useCallback(async () => {
    if (!campaignId) return
    try {
      let url = `${API}/campaign?id=${encodeURIComponent(campaignId)}`
      if (wallet) url += `&address=${wallet}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCampaign(data.campaign || data)
      setParticipant(data.participant || null)
    } catch {
      setLoadError(true)
    }
  }, [campaignId, wallet])

  // Load leaderboard
  const loadLeaderboard = useCallback(async () => {
    if (!campaignId) return
    try {
      const res = await fetch(`${API}/leaderboard?campaign_id=${encodeURIComponent(campaignId)}&limit=10`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setLeaderboard(data)
    } catch {}
  }, [campaignId])

  useEffect(() => {
    loadCampaign()
    loadLeaderboard()
  }, [loadCampaign, loadLeaderboard])

  // Join campaign
  async function joinCampaign() {
    if (!wallet) return
    setJoining(true)
    try {
      const referrer = localStorage.getItem('mw_referrer') || null
      const body: Record<string, unknown> = { wallet, campaign_id: campaignId }
      if (referrer) body.referred_by = referrer
      const res = await fetch(`${API}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error && !data.error.includes('already')) throw new Error(data.error)
      await loadCampaign()
    } catch (e) {
      alert('Could not join: ' + (e as Error).message)
    } finally {
      setJoining(false)
    }
  }

  function copyRefLink(text: string, btn: HTMLButtonElement) {
    if (!wallet) return
    navigator.clipboard.writeText(text).catch(() => {})
    const orig = btn.textContent || 'Copy'
    btn.textContent = 'Copied ✓'
    setTimeout(() => { btn.textContent = orig }, 2000)
  }

  function openExternal(type: string) {
    const urls: Record<string, string> = {
      bridge: 'https://bridge.coredao.org',
      trade: 'https://app.coredao.org/swap',
    }
    window.open(urls[type] || '#', '_blank', 'noopener')
  }

  if (loadError) {
    return (
      <div className="page">
        <div className="page-loader">
          <div className="page-loader-icon">⚠️</div>
          <div className="page-loader-text">
            Could not load campaign.<br />
            <Link href="/dashboard" style={{color:'var(--blue)'}}>← Back to campaigns</Link>
          </div>
        </div>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="page">
        <div className="page-loader">
          <div className="page-loader-icon">⏳</div>
          <div className="page-loader-text">Loading campaign…</div>
        </div>
      </div>
    )
  }

  const c = campaign
  const p = participant
  const isLive = c.status === 'live'
  const col = iconColor(c.name)
  const initial = c.name.charAt(0).toUpperCase()
  const daysLeft = c.end_date ? daysUntil(c.end_date) : null
  const multiplier = p ? parseFloat(p.score_multiplier || '1') : 1
  const score = p?.attribution_score || 0
  const minScore = c.min_score || 200
  const eligible = score >= minScore
  const totalEarned = p ? parseFloat(p.total_earned_usd || '0') : 0
  const totalPoints = p?.total_points || 0
  const actDays = p?.active_trading_days || 0
  const actionCount = Object.keys(c.actions || {}).length

  const bridgeLink = wallet ? `mintware.io/r/${wallet.slice(0,10)}/${campaignId}/bridge` : 'Connect wallet to get link'
  const tradeLink  = wallet ? `mintware.io/r/${wallet.slice(0,10)}/${campaignId}/trade` : 'Connect wallet to get link'

  // Find user in leaderboard
  const userLbIdx = wallet ? leaderboard.findIndex(r => r.wallet === wallet) : -1

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link href="/dashboard">Earn</Link>
        <span className="breadcrumb-sep">›</span>
        <span className="breadcrumb-current">{c.name}</span>
      </div>

      {/* Campaign Hero */}
      <div className="campaign-hero">
        <div className="hero-top">
          <div className="hero-icon" style={{background:col.bg,color:col.fg}}>{initial}</div>
          <div className="hero-head">
            <div className="hero-name-row">
              <div className="hero-name">{c.name}</div>
              {isLive
                ? <div className="hero-live"><span className="hero-live-dot" />Live</div>
                : <div className="hero-soon">Upcoming</div>}
            </div>
            <div className="hero-sub">{c.chain}{daysLeft !== null ? ` · Ends in ${daysLeft} days` : ''}{c.protocol ? ` · ${c.protocol}` : ''}</div>
            <div className="hero-desc">
              {c.name} rewards {actionCount} activities — bridge, trade, and invite others. All activity earns points. Every 24 hours, a portion of the {fmtUSD(c.pool_usd)} {c.token_symbol} pool distributes to all active participants, weighted by that day's score.
            </div>
          </div>
        </div>
        <div className="hero-stats">
          <div className="hero-stat"><div className="hero-stat-val val-orange">{fmtUSD(c.pool_usd)}</div><div className="hero-stat-label">Total pool</div></div>
          <div className="hero-stat"><div className="hero-stat-val val-blue">{fmtUSD(c.daily_payout_usd)}</div><div className="hero-stat-label">Daily payout</div></div>
          <div className="hero-stat"><div className="hero-stat-val val-green">{p ? '$' + totalEarned.toFixed(2) : '—'}</div><div className="hero-stat-label">You've earned</div></div>
          <div className="hero-stat"><div className="hero-stat-val val-white">{daysLeft !== null ? daysLeft + 'd' : '—'}</div><div className="hero-stat-label">Remaining</div></div>
        </div>
      </div>

      {/* Eligibility Strip */}
      {wallet && p ? (
        <div className="elig-strip">
          <div className="elig-icon" style={{background:eligible?'var(--green-bg)':'rgba(251,191,36,0.1)',border:`1px solid ${eligible?'var(--green-border)':'rgba(180,83,9,0.2)'}`}}>
            {eligible ? '✓' : '⚡'}
          </div>
          <div className="elig-text">
            <div className="elig-title">{eligible ? `You're eligible — score ${score} qualifies for full participation` : `Score ${score} is below the minimum of ${minScore}`}</div>
            <div className="elig-sub">Minimum score {minScore} · {eligible ? `Your ${multiplier.toFixed(1)}× multiplier is active` : 'Keep using DeFi to raise your attribution score'}</div>
          </div>
          <div className="elig-bar-wrap">
            <div className="elig-bar">
              <div className="elig-fill" style={{width:Math.min(100,Math.round((score/1000)*100))+'%',background:eligible?'linear-gradient(90deg,var(--blue),#7C3AED)':'#f97316'}} />
            </div>
            <span className="elig-pct">{score} / 1000</span>
          </div>
          {eligible && <div className="elig-badge">{multiplier.toFixed(1)}× weight</div>}
        </div>
      ) : wallet && !p ? (
        <div className="elig-strip">
          <div className="elig-icon" style={{background:'var(--blue-dim)',border:'1px solid rgba(0,82,255,0.15)'}}>🚀</div>
          <div className="elig-text">
            <div className="elig-title">Join this campaign to start earning</div>
            <div className="elig-sub">Minimum score {minScore} required · Joining links your wallet to this campaign</div>
          </div>
          <button className="join-btn" onClick={joinCampaign} disabled={joining}>
            {joining ? 'Joining…' : 'Join campaign'}
          </button>
        </div>
      ) : (
        <div className="elig-strip">
          <div className="elig-icon" style={{background:'var(--surface)',border:'1px solid var(--border)'}}>🔗</div>
          <div className="elig-text">
            <div className="elig-title">Connect wallet to check eligibility</div>
            <div className="elig-sub">Minimum score {minScore} required to participate</div>
          </div>
        </div>
      )}

      <div className="grid">
        <div>
          {/* Actions card */}
          <div className="card" style={{animation:'fadeUp 0.5s 0.12s ease both'}}>
            <div className="card-title">
              How to earn points
              <span className="card-title-badge">{actionCount} activities · 1 pool</span>
            </div>
            <div className="action-list">
              {Object.entries(c.actions || {}).map(([key, action]) => {
                const meta = actionMeta(key)
                const pts = action.points
                const multiplied = Math.round(pts * multiplier)
                const ptsLabel = action.per_day ? `+${pts} pts/day` : action.per_referral ? `+${pts} pts/ref` : action.per_referred_trade ? `+${pts} pts/their trade` : `+${pts} pts`
                const multLabel = (p && multiplier > 1) ? `→ +${multiplied} with ${multiplier.toFixed(1)}×` : ''

                let actionBtn = null
                if (key === 'bridge') {
                  const done = p && (p.bridge_points || 0) > 0
                  actionBtn = done
                    ? <button className="action-btn done">Done ✓</button>
                    : <button className="action-btn" onClick={() => openExternal('bridge')}>Bridge now</button>
                } else if (key === 'trade') {
                  actionBtn = <button className="action-btn" onClick={() => openExternal('trade')}>Trade now</button>
                } else if (key.startsWith('referral')) {
                  const refType = key === 'referral_bridge' ? 'bridge' : 'trade'
                  const refLink = wallet
                    ? `mintware.io/r/${wallet.slice(0,10)}/${campaignId}/${refType}`
                    : 'Connect wallet for link'
                  actionBtn = (
                    <button
                      className="action-btn copy"
                      onClick={e => copyRefLink(refLink, e.currentTarget)}
                    >
                      {wallet ? 'Copy link' : 'Connect'}
                    </button>
                  )
                }

                return (
                  <div key={key} className="action">
                    <div className="action-icon" style={{background:meta.bg}}>{meta.icon}</div>
                    <div className="action-body">
                      <div className="action-name">{action.label}</div>
                      <div className="action-desc">{meta.desc}</div>
                    </div>
                    <div className="action-right">
                      <div className="action-pts">{ptsLabel}</div>
                      {multLabel && <div className="action-multiplied">{multLabel}</div>}
                      {actionBtn}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Progress card */}
          {wallet && p ? (
            <div className="card" style={{animation:'fadeUp 0.5s 0.18s ease both'}}>
              <div className="card-title">Your progress <span className="card-title-badge">{actDays} days active</span></div>
              <div className="progress-grid">
                <div className="prog-stat"><div className="prog-stat-val blue">{totalPoints.toLocaleString()}</div><div className="prog-stat-label">Points earned</div></div>
                <div className="prog-stat"><div className="prog-stat-val green">${totalEarned.toFixed(2)}</div><div className="prog-stat-label">Already paid out</div></div>
                <div className="prog-stat"><div className="prog-stat-val">{actDays}</div><div className="prog-stat-label">Active days</div></div>
                <div className="prog-stat"><div className="prog-stat-val">{(p.referral_bridge_points || 0) > 0 ? Math.round((p.referral_bridge_points||0)/60) : (p.referral_trade_points||0) > 0 ? '1+' : '0'}</div><div className="prog-stat-label">Referrals active</div></div>
              </div>
              {(() => {
                const bPts = p.bridge_points || 0
                const tPts = p.trading_points || 0
                const rPts = (p.referral_bridge_points || 0) + (p.referral_trade_points || 0)
                const totalForBar = Math.max(bPts + tPts + rPts, 1)
                return (
                  <>
                    {bPts > 0 && <div className="prog-bar-wrap"><div className="prog-bar-label"><span>🌉 Bridge</span><span>{bPts} pts</span></div><div className="prog-bar"><div className="prog-fill" style={{width:Math.min(100,Math.round(bPts/totalForBar*100))+'%',background:'var(--blue)'}} /></div></div>}
                    {tPts > 0 && <div className="prog-bar-wrap"><div className="prog-bar-label"><span>📈 Trading</span><span>{tPts} pts · {actDays} days</span></div><div className="prog-bar"><div className="prog-fill" style={{width:Math.min(100,Math.round(tPts/totalForBar*100))+'%',background:'#2A9E8A'}} /></div></div>}
                    {rPts > 0 && <div className="prog-bar-wrap" style={{marginBottom:0}}><div className="prog-bar-label"><span>🔗 Referrals</span><span>{rPts} pts</span></div><div className="prog-bar"><div className="prog-fill" style={{width:Math.min(100,Math.round(rPts/totalForBar*100))+'%',background:'#7B6FCC'}} /></div></div>}
                  </>
                )
              })()}
              <div style={{marginTop:14,padding:'12px 14px',background:'var(--surface)',borderRadius:10,fontSize:12,color:'var(--ink-3)',lineHeight:1.5}}>
                {fmtUSD(c.daily_payout_usd)} {c.token_symbol} distributes every 24 hours to all active participants, weighted by that day's score. Stay active daily to maximize earnings.
              </div>
            </div>
          ) : wallet ? (
            <div className="card" style={{animation:'fadeUp 0.5s 0.18s ease both'}}>
              <div className="card-title">Your progress</div>
              <div className="connect-prompt-card">
                <div className="connect-prompt-icon">🚀</div>
                <div className="connect-prompt-text">Join this campaign to start tracking your points and earnings.</div>
                <button className="connect-prompt-btn" onClick={joinCampaign}>Join campaign</button>
              </div>
            </div>
          ) : null}

          {/* Leaderboard card */}
          <div className="card" style={{animation:'fadeUp 0.5s 0.24s ease both'}}>
            <div className="card-title">
              Campaign leaderboard
              <span className="card-title-badge">{leaderboard.length} participant{leaderboard.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="lb-list">
              {leaderboard.length === 0 ? (
                <div style={{textAlign:'center',padding:20,color:'var(--ink-3)',fontSize:13}}>
                  {campaign ? 'No participants yet — be the first!' : 'Loading leaderboard…'}
                </div>
              ) : (
                <>
                  {leaderboard.slice(0, 5).map((row, i) => {
                    const isYou = wallet && row.wallet === wallet
                    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''
                    const acol = avatarColors[i] || { bg:'var(--surface)', fg:'var(--ink-3)' }
                    return (
                      <div key={row.wallet} className={`lb-row${isYou ? ' you' : ''}`}>
                        <span className={`lb-rank ${rankClass}`}>#{i+1}</span>
                        <div className="lb-avatar" style={{background:isYou?'var(--blue-dim)':acol.bg,color:isYou?'var(--blue)':acol.fg}}>
                          {row.wallet.charAt(2).toUpperCase()}
                        </div>
                        <span className="lb-addr">{shortAddr(row.wallet)}</span>
                        {isYou && <span className="lb-you-tag">you</span>}
                        <span className="lb-pts">{(row.total_points||0).toLocaleString()} pts</span>
                        <span className="lb-earned">${parseFloat(String(row.total_earned_usd||0)).toFixed(0)}</span>
                      </div>
                    )
                  })}
                  {wallet && userLbIdx >= 5 && (() => {
                    const row = leaderboard[userLbIdx]
                    return (
                      <>
                        <div style={{height:1,background:'var(--border)',margin:'6px 0'}} />
                        <div className="lb-row you">
                          <span className="lb-rank">#{userLbIdx+1}</span>
                          <div className="lb-avatar" style={{background:'var(--blue-dim)',color:'var(--blue)'}}>
                            {wallet.charAt(2).toUpperCase()}
                          </div>
                          <span className="lb-addr">{shortAddr(wallet)}</span>
                          <span className="lb-you-tag">you</span>
                          <span className="lb-pts">{(row.total_points||0).toLocaleString()} pts</span>
                          <span className="lb-earned">${parseFloat(String(row.total_earned_usd||0)).toFixed(0)}</span>
                        </div>
                      </>
                    )
                  })()}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="sidebar">
          <Countdown dailyPayout={c.daily_payout_usd} tokenSymbol={c.token_symbol} daysLeft={daysLeft} />

          {/* Pool details */}
          <div className="side-card" style={{animation:'fadeUp 0.5s 0.18s ease both'}}>
            <div className="side-title">Reward pool</div>
            <div className="pool-row"><span className="pool-label">Total pool</span><span className="pool-val">{fmtUSD(c.pool_usd)} {c.token_symbol}</span></div>
            <div className="pool-row"><span className="pool-label">Daily payout</span><span className="pool-val blue">{fmtUSD(c.daily_payout_usd)} {c.token_symbol}</span></div>
            <div className="pool-row"><span className="pool-label">Payout schedule</span><span className="pool-val">Every 24 hrs</span></div>
            <div className="pool-row"><span className="pool-label">Minimum score</span><span className="pool-val">{minScore}+</span></div>
            {p && <>
              <div className="pool-row"><span className="pool-label">Your weight</span><span className="pool-val">{multiplier.toFixed(1)}×</span></div>
              <div className="pool-row"><span className="pool-label">You've earned</span><span className="pool-val green">${totalEarned.toFixed(2)}</span></div>
            </>}
            {daysLeft !== null && <div className="pool-row"><span className="pool-label">Days remaining</span><span className="pool-val">{daysLeft}d</span></div>}
          </div>

          {/* Referral links */}
          <div className="side-card" style={{animation:'fadeUp 0.5s 0.22s ease both'}}>
            <div className="side-title">Your referral links</div>
            <div style={{fontSize:12,color:'var(--ink-3)',lineHeight:1.55,marginBottom:16}}>Share the right link for what you want them to do. You earn points when they act.</div>
            <div style={{fontSize:11,fontWeight:700,color:'var(--ink-3)',letterSpacing:'0.5px',textTransform:'uppercase',marginBottom:6}}>Bridge link</div>
            <div style={{display:'flex',gap:6,marginBottom:12}}>
              <input className="ref-side-input" type="text" value={bridgeLink} readOnly />
              <button
                style={{padding:'9px 14px',borderRadius:8,background:'transparent',border:'1px solid var(--border-strong)',color:'var(--ink)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'var(--font-jakarta),Plus Jakarta Sans,sans-serif',whiteSpace:'nowrap',transition:'all 0.15s'}}
                onClick={e => copyRefLink(bridgeLink, e.currentTarget)}
              >Copy</button>
            </div>
            <div style={{fontSize:11,fontWeight:700,color:'var(--ink-3)',letterSpacing:'0.5px',textTransform:'uppercase',marginBottom:6}}>Trade link</div>
            <div style={{display:'flex',gap:6,marginBottom:12}}>
              <input className="ref-side-input" type="text" value={tradeLink} readOnly />
              <button
                style={{padding:'9px 14px',borderRadius:8,background:'transparent',border:'1px solid var(--border-strong)',color:'var(--ink)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'var(--font-jakarta),Plus Jakarta Sans,sans-serif',whiteSpace:'nowrap',transition:'all 0.15s'}}
                onClick={e => copyRefLink(tradeLink, e.currentTarget)}
              >Copy</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CampaignPage() {
  return (
    <>
      <style>{`
        :root{
          --blue:#0052FF;--blue-dim:rgba(0,82,255,0.07);--blue-mid:rgba(0,82,255,0.14);
          --ink:#1A1A2E;--ink-2:#3A3C52;--ink-3:#8A8C9E;
          --surface:#F7F6FF;--white:#ffffff;
          --green:#16a34a;--green-bg:#f0fdf4;--green-border:#bbf7d0;
          --border:rgba(26,26,46,0.08);--border-strong:rgba(26,26,46,0.13);
          --shadow:0 1px 4px rgba(26,26,46,0.06);--shadow-md:0 4px 16px rgba(26,26,46,0.08);
        }
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;background:var(--surface);color:var(--ink);min-height:100vh}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes barFill{from{width:0}to{width:var(--w)}}
        .page{max-width:960px;margin:0 auto;padding:40px 48px 80px}
        .breadcrumb{display:flex;align-items:center;gap:8px;margin-bottom:28px;animation:fadeUp 0.4s ease both}
        .breadcrumb a{font-size:13px;color:var(--ink-3);text-decoration:none;transition:color 0.15s}
        .breadcrumb a:hover{color:var(--ink)}
        .breadcrumb-sep{font-size:13px;color:var(--border-strong)}
        .breadcrumb-current{font-size:13px;color:var(--ink);font-weight:500}
        .page-loader{text-align:center;padding:80px 24px;color:var(--ink-3)}
        .page-loader-icon{font-size:32px;margin-bottom:12px}
        .page-loader-text{font-size:15px}
        .campaign-hero{background:var(--ink);border-radius:20px;padding:32px;margin-bottom:12px;position:relative;overflow:hidden;animation:fadeUp 0.5s ease both}
        .campaign-hero::before{content:'';position:absolute;top:-60px;right:-60px;width:280px;height:280px;background:radial-gradient(circle,rgba(249,115,22,0.12) 0%,transparent 65%);pointer-events:none}
        .campaign-hero::after{content:'';position:absolute;bottom:-40px;left:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(0,82,255,0.1) 0%,transparent 65%);pointer-events:none}
        .hero-top{display:flex;align-items:flex-start;gap:20px;margin-bottom:24px;position:relative}
        .hero-icon{width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;flex-shrink:0}
        .hero-head{flex:1}
        .hero-name-row{display:flex;align-items:center;gap:10px;margin-bottom:6px}
        .hero-name{font-family:Georgia,serif;font-size:26px;font-weight:700;color:rgba(255,255,255,0.92);letter-spacing:-0.5px}
        .hero-live{display:inline-flex;align-items:center;gap:5px;background:rgba(22,163,74,0.15);border:1px solid rgba(22,163,74,0.3);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;color:#4ade80}
        .hero-live-dot{width:5px;height:5px;border-radius:50%;background:#4ade80;animation:pulse 2s ease infinite}
        .hero-soon{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.4)}
        .hero-sub{font-size:13px;color:rgba(255,255,255,0.38);font-family:var(--font-mono),'DM Mono',monospace;margin-bottom:12px}
        .hero-desc{font-size:14px;color:rgba(255,255,255,0.55);line-height:1.6;max-width:520px}
        .hero-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;position:relative}
        .hero-stat{background:rgba(255,255,255,0.03);padding:18px 20px;text-align:center}
        .hero-stat-val{font-family:Georgia,serif;font-size:22px;font-weight:700;letter-spacing:-0.5px;margin-bottom:4px}
        .hero-stat-label{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.25)}
        .val-white{color:rgba(255,255,255,0.88)}.val-orange{color:#fb923c}.val-green{color:#4ade80}.val-blue{color:#6b9fff}
        .elig-strip{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:18px 24px;display:flex;align-items:center;gap:16px;margin-bottom:28px;animation:fadeUp 0.5s 0.08s ease both}
        .elig-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
        .elig-text{flex:1}
        .elig-title{font-size:13px;font-weight:600;color:var(--ink);margin-bottom:3px}
        .elig-sub{font-size:12px;color:var(--ink-3)}
        .elig-bar-wrap{flex:1;display:flex;align-items:center;gap:10px;min-width:0}
        .elig-bar{flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden}
        .elig-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--blue),#7C3AED)}
        .elig-pct{font-family:var(--font-mono),'DM Mono',monospace;font-size:12px;color:var(--blue);white-space:nowrap;font-weight:500}
        .elig-badge{flex-shrink:0;font-size:12px;font-weight:600;color:var(--green);background:var(--green-bg);border:1px solid var(--green-border);border-radius:20px;padding:4px 12px;white-space:nowrap}
        .join-btn{flex-shrink:0;padding:10px 22px;border-radius:10px;background:var(--blue);color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:background 0.15s;white-space:nowrap}
        .join-btn:hover{background:#0040cc}.join-btn:disabled{background:var(--green);cursor:default}
        .grid{display:grid;grid-template-columns:1fr 340px;gap:16px;align-items:start}
        .card{background:var(--white);border:1px solid var(--border);border-radius:16px;padding:24px;margin-bottom:16px}
        .card:last-child{margin-bottom:0}
        .card-title{font-size:13px;font-weight:700;letter-spacing:0.5px;color:var(--ink);margin-bottom:18px;display:flex;align-items:center;justify-content:space-between}
        .card-title-badge{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--ink-3);font-family:var(--font-mono),'DM Mono',monospace}
        .action-list{display:flex;flex-direction:column;gap:10px}
        .action{display:flex;align-items:center;gap:14px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;transition:all 0.15s}
        .action:hover{border-color:var(--border-strong);transform:translateY(-1px);box-shadow:var(--shadow)}
        .action-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
        .action-body{flex:1}
        .action-name{font-size:14px;font-weight:600;color:var(--ink);margin-bottom:3px}
        .action-desc{font-size:12px;color:var(--ink-3);line-height:1.5}
        .action-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0}
        .action-pts{font-family:var(--font-mono),'DM Mono',monospace;font-size:14px;font-weight:500;color:var(--blue);white-space:nowrap}
        .action-multiplied{font-size:11px;color:var(--green);font-weight:600;white-space:nowrap}
        .action-btn{padding:7px 16px;border-radius:8px;background:var(--blue);color:white;border:none;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:background 0.15s;white-space:nowrap}
        .action-btn:hover{background:#0040cc}
        .action-btn.done{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border);cursor:default}
        .action-btn.copy{background:transparent;color:var(--ink);border:1px solid var(--border-strong)}
        .action-btn.copy:hover{border-color:var(--blue);color:var(--blue)}
        .progress-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px}
        .prog-stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
        .prog-stat-val{font-family:Georgia,serif;font-size:20px;font-weight:700;color:var(--ink);letter-spacing:-0.5px;margin-bottom:3px}
        .prog-stat-val.blue{color:var(--blue)}.prog-stat-val.green{color:var(--green)}
        .prog-stat-label{font-size:11px;color:var(--ink-3)}
        .prog-bar-wrap{margin-bottom:10px}
        .prog-bar-label{display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px}
        .prog-bar-label span:first-child{color:var(--ink-3)}
        .prog-bar-label span:last-child{color:var(--ink);font-weight:600;font-family:var(--font-mono),'DM Mono',monospace}
        .prog-bar{height:5px;background:var(--border);border-radius:3px;overflow:hidden}
        .prog-fill{height:100%;border-radius:3px}
        .connect-prompt-card{text-align:center;padding:32px 24px;color:var(--ink-3)}
        .connect-prompt-icon{font-size:28px;margin-bottom:10px}
        .connect-prompt-text{font-size:13px;margin-bottom:16px;line-height:1.5}
        .connect-prompt-btn{padding:10px 24px;border-radius:10px;background:var(--blue);color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:background 0.15s}
        .connect-prompt-btn:hover{background:#0040cc}
        .lb-list{display:flex;flex-direction:column;gap:6px}
        .lb-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;transition:background 0.15s}
        .lb-row:hover{background:var(--surface)}
        .lb-row.you{background:var(--blue-dim);border:1px solid rgba(0,82,255,0.15)}
        .lb-rank{font-family:var(--font-mono),'DM Mono',monospace;font-size:12px;color:var(--ink-3);width:28px;text-align:right;flex-shrink:0}
        .lb-rank.gold{color:#B45309;font-weight:700}.lb-rank.silver{color:var(--ink-2);font-weight:700}.lb-rank.bronze{color:#92400E;font-weight:700}
        .lb-avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}
        .lb-addr{font-family:var(--font-mono),'DM Mono',monospace;font-size:12px;color:var(--ink-2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .lb-you-tag{font-size:10px;font-weight:700;color:var(--blue);background:var(--blue-dim);border:1px solid rgba(0,82,255,0.2);border-radius:10px;padding:1px 7px;flex-shrink:0}
        .lb-pts{font-family:var(--font-mono),'DM Mono',monospace;font-size:12px;color:var(--ink);font-weight:500;white-space:nowrap}
        .lb-earned{font-size:11px;color:var(--green);font-weight:600;white-space:nowrap;margin-left:4px}
        .side-card{background:var(--white);border:1px solid var(--border);border-radius:16px;padding:22px;margin-bottom:16px}
        .side-card:last-child{margin-bottom:0}
        .side-title{font-size:13px;font-weight:700;color:var(--ink);margin-bottom:14px}
        .time-ring{display:flex;flex-direction:column;align-items:center;padding:8px 0 16px}
        .time-units{display:flex;gap:16px;justify-content:center}
        .time-unit{text-align:center}
        .time-num{font-family:Georgia,serif;font-size:28px;font-weight:700;color:var(--ink);letter-spacing:-1px;line-height:1}
        .time-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--ink-3);margin-top:4px}
        .time-sep{font-family:Georgia,serif;font-size:24px;color:var(--border-strong);line-height:1;margin-top:4px}
        .time-bar{margin-top:16px;height:4px;background:var(--border);border-radius:2px;overflow:hidden}
        .time-fill{height:100%;background:linear-gradient(90deg,var(--blue),#7C3AED);border-radius:2px}
        .ref-side-input{flex:1;padding:9px 12px;background:var(--surface);border:1px solid var(--border-strong);border-radius:8px;font-family:var(--font-mono),'DM Mono',monospace;font-size:12px;color:var(--ink-2);outline:none}
        .pool-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)}
        .pool-row:last-child{border-bottom:none}
        .pool-label{font-size:12px;color:var(--ink-3)}
        .pool-val{font-size:12px;font-weight:600;color:var(--ink);font-family:var(--font-mono),'DM Mono',monospace}
        .pool-val.blue{color:var(--blue)}.pool-val.green{color:var(--green)}
        @media(max-width:760px){
          .page{padding:24px 20px 60px}
          .grid{grid-template-columns:1fr}
          .hero-stats{grid-template-columns:repeat(2,1fr)}
          .progress-grid{grid-template-columns:1fr}
          .elig-strip{flex-wrap:wrap}
        }
      `}</style>
      <MwNav />
      <MwAuthGuard>
        <CampaignContent />
      </MwAuthGuard>
    </>
  )
}

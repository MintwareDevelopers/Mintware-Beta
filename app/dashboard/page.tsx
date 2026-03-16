'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { API, fmtUSD, daysUntil, iconColor } from '@/lib/api'

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
  actions?: Record<string, { label: string; points: number; per_day?: boolean; one_time?: boolean; per_referral?: boolean }>
}

interface Participant {
  total_points: number
  total_earned_usd: string
  attribution_score: number
  score_multiplier: string
  bridge_points?: number
  trading_points?: number
  referral_bridge_points?: number
  referral_trade_points?: number
  active_trading_days?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function actionTagClass(key: string) {
  if (key.startsWith('referral')) return 'tag-purple'
  if (key === 'bridge') return 'tag-blue'
  if (key === 'trade') return 'tag-green'
  if (key === 'hold') return 'tag-amber'
  return 'tag-gray'
}

// ─── Campaign Card ────────────────────────────────────────────────────────────
function CampaignCard({ c, wallet, participant }: { c: Campaign; wallet: string; participant?: Participant }) {
  const router = useRouter()
  const isLive = c.status === 'live'
  const col = iconColor(c.name)
  const initial = c.name.charAt(0).toUpperCase()
  const daysLeft = c.end_date ? daysUntil(c.end_date) : null
  const sub = isLive
    ? `${c.chain} · ${daysLeft !== null ? `Ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : 'Ongoing'}`
    : `${c.chain} · Launching soon`
  const poolDisplay = fmtUSD(c.pool_usd) + ' ' + (c.token_symbol || '')
  const dailyDisplay = fmtUSD(c.daily_payout_usd) + '/day'
  const minScore = c.min_score || 200

  const score = participant?.attribution_score || 0
  const mult = parseFloat(participant?.score_multiplier || '1').toFixed(1)

  return (
    <div className={`campaign-card${isLive ? ' featured' : ' upcoming'}`}>
      <div className="campaign-top">
        <div className="campaign-icon" style={{background:col.bg,color:col.fg}}>{initial}</div>
        <div className="campaign-head">
          <div className="campaign-name-row">
            <div className="campaign-name">{c.name}</div>
            {isLive
              ? <div className="campaign-live-badge"><span className="campaign-live-dot" />Live</div>
              : <div className="campaign-soon-badge">Upcoming</div>}
          </div>
          <div className="campaign-sub">{sub}</div>
          <div className="campaign-tags">
            {Object.entries(c.actions || {}).map(([key, action]) => {
              const suffix = action.per_day ? '/day' : action.one_time ? '' : action.per_referral ? '/ref' : ''
              const labelWord = action.label.split(' ')[0].toLowerCase()
              return <span key={key} className={`tag ${actionTagClass(key)}`}>+{action.points} {labelWord}{suffix}</span>
            })}
          </div>
        </div>
        <div className="campaign-right">
          <div>
            <div className="campaign-reward-val">{poolDisplay}</div>
            <div className="campaign-reward-participants">{dailyDisplay} payout</div>
          </div>
          {isLive
            ? <button className="campaign-btn btn-earn" onClick={() => router.push(`/campaign/${c.id}`)}>Earn now</button>
            : <button className="campaign-btn btn-waitlist">Join waitlist</button>}
        </div>
      </div>
      {isLive && (
        <div className="campaign-bottom">
          <span className="elig-label">
            {wallet && participant ? 'Your eligibility' : 'Score required'}
          </span>
          <div className="elig-bar">
            {wallet && participant ? (
              <div className="elig-fill" style={{
                width: Math.min(100, Math.round((score/1000)*100)) + '%',
                background: score >= minScore ? 'var(--blue)' : '#f97316'
              }} />
            ) : (
              <div className="elig-fill" style={{width:'0%',background:'var(--border-strong)'}} />
            )}
          </div>
          {wallet && participant ? (
            <>
              <span className="elig-score">{score} / 1000</span>
              {score >= minScore
                ? <span className="elig-multiplier">{mult}× weight</span>
                : <span className="elig-multiplier" style={{color:'#B45309',background:'rgba(251,191,36,0.08)',borderColor:'rgba(180,83,9,0.2)'}}>Min {minScore} req.</span>}
            </>
          ) : (
            <span className="elig-score" style={{color:'var(--ink-3)'}}>Need {minScore}+</span>
          )}
        </div>
      )}
      {isLive && participant && (participant.total_points || participant.total_earned_usd) && (
        <div className="campaign-progress">
          <div className="progress-row">
            <span className="progress-label">Your progress this campaign</span>
            <span className="progress-val">{(participant.total_points||0).toLocaleString()} pts · ${parseFloat(participant.total_earned_usd||'0').toFixed(2)} earned</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{width: Math.min(100, Math.round(((participant.total_points||0)/1000)*100)) + '%'}} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Dashboard Content ────────────────────────────────────────────────────────
function DashboardContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const searchParams = useSearchParams()

  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([])
  const [participantData, setParticipantData] = useState<Record<string, Participant>>({})
  const [currentFilter, setCurrentFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scoreNum, setScoreNum] = useState<number | null>(null)
  const [scoreMeta, setScoreMeta] = useState('Loading your data…')
  const [scoreWeight, setScoreWeight] = useState('⚡ Calculating reward weight…')
  const [statCampaigns, setStatCampaigns] = useState('—')
  const [statEarned, setStatEarned] = useState('—')
  const [refCount, setRefCount] = useState('—')
  const [copiedRef, setCopiedRef] = useState(false)

  const refLink = wallet ? 'mintware.io/r/' + wallet.slice(0,10) : ''

  // Track referrer from URL
  useEffect(() => {
    const ref = searchParams.get('ref') || searchParams.get('r')
    if (ref && /^0x[0-9a-f]{40}$/i.test(ref)) {
      localStorage.setItem('mw_referrer', ref.toLowerCase())
    }
  }, [searchParams])

  // Load campaigns
  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`${API}/campaigns`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('Unexpected response')
      setAllCampaigns(data)
    } catch {
      setError('Could not load campaigns. Please refresh and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load participant data for each campaign
  const loadParticipantData = useCallback(async (campaigns: Campaign[]) => {
    if (!wallet) return
    const liveCampaigns = campaigns.filter(c => c.status === 'live')
    let totalEarned = 0
    let activeCount = 0
    const pData: Record<string, Participant> = {}

    await Promise.all(liveCampaigns.map(async (c) => {
      try {
        const res = await fetch(`${API}/campaign?id=${c.id}&address=${wallet}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.participant) {
          pData[c.id] = data.participant
          totalEarned += parseFloat(data.participant.total_earned_usd) || 0
          activeCount++
        }
      } catch {}
    }))

    setParticipantData(pData)

    const firstParticipant = Object.values(pData)[0]
    const score = firstParticipant?.attribution_score || 0
    const multiplier = parseFloat(firstParticipant?.score_multiplier || '1').toFixed(1)

    setScoreNum(score || null)
    setScoreMeta(activeCount
      ? `Active in ${activeCount} campaign${activeCount > 1 ? 's' : ''} · ${Object.values(pData).reduce((s,p) => s + (p.total_points||0), 0).toLocaleString()} total points`
      : 'No active campaigns yet — join one below')
    setScoreWeight(`⚡ ${multiplier}× reward weight`)
    setStatCampaigns(String(activeCount || 0))
    setStatEarned(totalEarned > 0 ? '$' + totalEarned.toFixed(0) : '$0')
    setRefCount('—')
  }, [wallet])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  useEffect(() => {
    if (allCampaigns.length > 0 && wallet) {
      loadParticipantData(allCampaigns)
    }
  }, [allCampaigns, wallet, loadParticipantData])

  function getFiltered() {
    let list = [...allCampaigns]
    if (currentFilter === 'Live') list = list.filter(c => c.status === 'live')
    if (currentFilter === 'Bitcoin DeFi') list = list.filter(c => /bitcoin/i.test(c.chain))
    if (currentFilter === 'Eligible') list = list.filter(c => c.status === 'live')
    return list
  }

  function copyReferralLink() {
    if (!wallet || !refLink) return
    navigator.clipboard.writeText(refLink).catch(() => {})
    setCopiedRef(true)
    setTimeout(() => setCopiedRef(false), 2000)
  }

  const filtered = getFiltered()

  return (
    <div className="page">
      {error && <div className="error-banner" style={{display:'block'}}>{error}</div>}

      {/* Score Banner */}
      <div className="score-banner" style={{marginBottom:12}}>
        <div className="score-ring">
          <div className="score-ring-num">{scoreNum ?? '—'}</div>
        </div>
        <div className="score-main">
          <div className="score-title">Your Attribution Score</div>
          <div className="score-meta">{scoreMeta}</div>
          <div className="score-weight">{scoreWeight}</div>
        </div>
        <div className="score-divider" />
        <div className="score-stats">
          <div className="score-stat"><div className="score-stat-val">{statCampaigns}</div><div className="score-stat-label">Campaigns</div></div>
          <div className="score-stat"><div className="score-stat-val">{refCount}</div><div className="score-stat-label">Referrals</div></div>
          <div className="score-stat"><div className="score-stat-val green">{statEarned}</div><div className="score-stat-label">Earned</div></div>
        </div>
      </div>

      {/* Filters */}
      <div className="filters">
        {['All','Live','Bitcoin DeFi','Eligible'].map(f => (
          <button key={f} className={`filter-btn${currentFilter === f ? ' active' : ''}`} onClick={() => setCurrentFilter(f)}>{f === 'Eligible' ? 'Eligible for me' : f}</button>
        ))}
      </div>

      {/* Campaign list */}
      <div className="section-header">
        <span className="section-label">Active campaigns</span>
        <span className="section-count">{loading ? 'Loading…' : filtered.length === 0 ? 'No campaigns' : `${filtered.length} campaign${filtered.length !== 1 ? 's' : ''}`}</span>
      </div>

      <div className="campaigns">
        {loading ? (
          <>
            <div className="campaign-skeleton"><div className="skeleton-row medium"/><div className="skeleton-row short"/></div>
            <div className="campaign-skeleton"><div className="skeleton-row medium"/><div className="skeleton-row short"/></div>
          </>
        ) : filtered.length === 0 ? (
          <div className="campaigns-empty"><div className="campaigns-empty-icon">🔍</div><div className="campaigns-empty-text">No campaigns match this filter</div></div>
        ) : filtered.map(c => (
          <CampaignCard key={c.id} c={c} wallet={wallet} participant={participantData[c.id]} />
        ))}
      </div>

      {/* Referral Box */}
      <div className="referral-box">
        <div className="referral-top">
          <div>
            <div className="referral-title">Your referral link</div>
            <div className="referral-sub">Every wallet you refer that earns on any campaign adds permanently to your Attribution score — and earns you a share of their rewards, forever.</div>
          </div>
          <div className="referral-stats">
            <div className="ref-stat"><div className="ref-stat-val">{refCount}</div><div className="ref-stat-label">Referred</div></div>
            <div className="ref-stat"><div className="ref-stat-val green">—</div><div className="ref-stat-label">From refs</div></div>
          </div>
        </div>
        <div className="referral-row">
          <input className="referral-input" type="text" value={refLink || 'Loading your link…'} readOnly />
          <button className="referral-copy" onClick={copyReferralLink}>{copiedRef ? 'Copied ✓' : 'Copy link'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
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
        @keyframes shimmer{to{left:150%}}
        .page{max-width:960px;margin:0 auto;padding:44px 48px 80px}
        .score-banner{background:var(--ink);border-radius:20px;padding:28px 32px;display:flex;align-items:center;gap:28px;animation:fadeUp 0.5s ease both;position:relative;overflow:hidden}
        .score-banner::before{content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(0,82,255,0.15) 0%,transparent 70%);pointer-events:none}
        .score-ring{width:76px;height:76px;border-radius:50%;border:2px solid var(--blue);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:rgba(0,82,255,0.08)}
        .score-ring-num{font-family:Georgia,serif;font-size:28px;font-weight:700;color:var(--blue);letter-spacing:-1px;line-height:1}
        .score-main{flex:1}
        .score-title{font-size:15px;font-weight:600;color:rgba(255,255,255,0.88);margin-bottom:5px}
        .score-meta{font-size:12px;color:rgba(255,255,255,0.38);font-family:var(--font-mono),'DM Mono',monospace;margin-bottom:12px}
        .score-weight{display:inline-flex;align-items:center;gap:6px;background:rgba(0,82,255,0.15);border:1px solid rgba(0,82,255,0.3);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600;color:#6b9fff}
        .score-divider{width:1px;background:rgba(255,255,255,0.08);align-self:stretch;margin:0 4px}
        .score-stats{display:flex;gap:28px;flex-shrink:0}
        .score-stat{text-align:center;min-width:52px}
        .score-stat-val{font-family:Georgia,serif;font-size:22px;font-weight:700;color:rgba(255,255,255,0.88);letter-spacing:-0.5px}
        .score-stat-val.green{color:#4ade80}
        .score-stat-label{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-top:3px}
        .filters{display:flex;align-items:center;gap:8px;margin-bottom:20px;animation:fadeUp 0.5s 0.12s ease both}
        .filter-btn{padding:6px 16px;border-radius:20px;border:1px solid var(--border-strong);background:var(--white);color:var(--ink-3);font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:all 0.15s}
        .filter-btn:hover{border-color:var(--blue);color:var(--blue)}
        .filter-btn.active{background:var(--ink);color:white;border-color:var(--ink)}
        .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
        .section-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-3)}
        .section-count{font-size:12px;color:var(--ink-3);font-family:var(--font-mono),'DM Mono',monospace}
        .campaigns{display:flex;flex-direction:column;gap:10px;animation:fadeUp 0.5s 0.16s ease both;margin-bottom:32px}
        .campaign-skeleton{background:var(--white);border:1px solid var(--border);border-radius:16px;padding:22px 24px;min-height:110px;position:relative;overflow:hidden}
        .campaign-skeleton::after{content:'';position:absolute;top:0;left:-150%;width:150%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent);animation:shimmer 1.4s infinite}
        .skeleton-row{height:14px;border-radius:6px;background:var(--border);margin-bottom:10px}
        .skeleton-row.short{width:40%}.skeleton-row.medium{width:65%}
        .campaigns-empty{text-align:center;padding:48px 24px;color:var(--ink-3)}
        .campaigns-empty-icon{font-size:36px;margin-bottom:12px}
        .campaigns-empty-text{font-size:14px}
        .campaign-card{background:var(--white);border:1px solid var(--border);border-radius:16px;padding:22px 24px;transition:all 0.15s}
        .campaign-card:hover{border-color:var(--border-strong);box-shadow:var(--shadow-md);transform:translateY(-1px)}
        .campaign-card.featured{border-left:3px solid var(--blue)}
        .campaign-card.upcoming{opacity:0.75}
        .campaign-top{display:flex;align-items:flex-start;gap:16px}
        .campaign-icon{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0}
        .campaign-head{flex:1;min-width:0}
        .campaign-name-row{display:flex;align-items:center;gap:8px;margin-bottom:4px}
        .campaign-name{font-size:15px;font-weight:700;color:var(--ink)}
        .campaign-live-badge{display:inline-flex;align-items:center;gap:5px;background:var(--green-bg);border:1px solid var(--green-border);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;color:var(--green)}
        .campaign-live-dot{width:5px;height:5px;border-radius:50%;background:var(--green);animation:pulse 2s ease infinite}
        .campaign-soon-badge{background:rgba(26,26,46,0.05);border:1px solid var(--border-strong);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;color:var(--ink-3)}
        .campaign-sub{font-size:12px;color:var(--ink-3);font-family:var(--font-mono),'DM Mono',monospace;margin-bottom:12px}
        .campaign-tags{display:flex;gap:6px;flex-wrap:wrap}
        .tag{font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;border:1px solid;white-space:nowrap}
        .tag-blue{color:var(--blue);border-color:rgba(0,82,255,0.2);background:var(--blue-dim)}
        .tag-green{color:var(--green);border-color:var(--green-border);background:var(--green-bg)}
        .tag-purple{color:#7C3AED;border-color:rgba(124,58,237,0.2);background:rgba(124,58,237,0.06)}
        .tag-amber{color:#B45309;border-color:rgba(180,83,9,0.2);background:rgba(251,191,36,0.08)}
        .tag-gray{color:var(--ink-3);border-color:var(--border-strong);background:var(--surface)}
        .campaign-right{display:flex;flex-direction:column;align-items:flex-end;gap:10px;flex-shrink:0;margin-left:16px}
        .campaign-reward-val{font-family:var(--font-mono),'DM Mono',monospace;font-size:15px;font-weight:500;color:var(--ink);white-space:nowrap;text-align:right}
        .campaign-reward-participants{font-size:11px;color:var(--ink-3);text-align:right}
        .campaign-btn{padding:9px 22px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:all 0.15s;white-space:nowrap}
        .btn-earn{background:var(--blue);color:white;border:none}.btn-earn:hover{background:#0040cc}
        .btn-waitlist{background:transparent;color:var(--ink-3);border:1px solid var(--border-strong)}.btn-waitlist:hover{border-color:var(--blue);color:var(--blue)}
        .campaign-bottom{margin-top:16px;padding-top:14px;border-top:1px solid var(--border);display:flex;align-items:center;gap:14px}
        .elig-label{font-size:11px;color:var(--ink-3);white-space:nowrap}
        .elig-bar{flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden}
        .elig-fill{height:100%;border-radius:2px;background:var(--blue)}
        .elig-score{font-family:var(--font-mono),'DM Mono',monospace;font-size:11px;color:var(--blue);white-space:nowrap}
        .elig-multiplier{font-size:11px;font-weight:600;color:var(--green);background:var(--green-bg);border:1px solid var(--green-border);border-radius:20px;padding:2px 8px;white-space:nowrap}
        .campaign-progress{margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
        .progress-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
        .progress-label{font-size:11px;color:var(--ink-3)}
        .progress-val{font-size:11px;font-weight:600;color:var(--ink);font-family:var(--font-mono),'DM Mono',monospace}
        .progress-bar{height:4px;background:var(--border);border-radius:2px;overflow:hidden}
        .progress-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--blue),#7C3AED)}
        .referral-box{background:var(--ink);border-radius:20px;padding:28px 32px;animation:fadeUp 0.5s 0.28s ease both;position:relative;overflow:hidden}
        .referral-box::before{content:'';position:absolute;bottom:-40px;right:-20px;width:180px;height:180px;background:radial-gradient(circle,rgba(0,82,255,0.12) 0%,transparent 70%);pointer-events:none}
        .referral-top{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:20px}
        .referral-title{font-size:16px;font-weight:600;color:rgba(255,255,255,0.88);margin-bottom:6px}
        .referral-sub{font-size:13px;color:rgba(255,255,255,0.38);line-height:1.55;max-width:440px}
        .referral-stats{display:flex;gap:12px;flex-shrink:0}
        .ref-stat{text-align:center;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 20px}
        .ref-stat-val{font-family:Georgia,serif;font-size:20px;font-weight:700;color:rgba(255,255,255,0.88);letter-spacing:-0.5px}
        .ref-stat-val.green{color:#4ade80}
        .ref-stat-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-top:3px}
        .referral-row{display:flex;gap:10px;align-items:center}
        .referral-input{flex:1;padding:11px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;font-family:var(--font-mono),'DM Mono',monospace;font-size:13px;color:rgba(255,255,255,0.6);outline:none}
        .referral-copy{padding:11px 22px;border-radius:10px;background:var(--blue);color:white;border:none;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:background 0.15s;white-space:nowrap}
        .referral-copy:hover{background:#0040cc}
        .error-banner{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.18);border-radius:12px;padding:12px 16px;font-size:13px;color:#dc2626;margin-bottom:16px}
        @media(max-width:720px){
          .page{padding:24px 20px 60px}
          .score-banner{flex-wrap:wrap}
          .campaign-top{flex-wrap:wrap}
          .campaign-right{flex-direction:row;align-items:center;margin-left:0;width:100%;justify-content:space-between}
          .referral-top{flex-direction:column}
          .referral-stats{width:100%}
        }
      `}</style>
      <MwNav />
      <MwAuthGuard>
        <DashboardContent />
      </MwAuthGuard>
    </>
  )
}

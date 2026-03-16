'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState } from 'react'
import { API, shortAddr } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScoreData {
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

const SCORE_DIMS = [
  { name: 'LP behavior',      key: 'lp_behavior' },
  { name: 'DeFi competence',  key: 'defi_competence' },
  { name: 'Wallet longevity', key: 'wallet_longevity' },
  { name: 'Network & referral', key: 'network_referral' },
]

const CHAINS = [
  { name: 'Base',     letter: 'B', bg: '#e8f0ff', fg: '#0052FF' },
  { name: 'Sonic',    letter: 'S', bg: '#fff4e8', fg: '#f97316' },
  { name: 'Ethereum', letter: 'Ξ', bg: '#eef2ff', fg: '#6366f1' },
  { name: 'Arbitrum', letter: 'A', bg: '#f0fdf4', fg: '#16a34a' },
  { name: 'OP',       letter: 'O', bg: '#fdf4ff', fg: '#a855f7' },
]

// ─── Tab component ────────────────────────────────────────────────────────────
type Tab = 'portfolio' | 'score' | 'badge'

function ProfileContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [scoreData, setScoreData] = useState<ScoreData | null>(null)
  const [copied, setCopied] = useState(false)

  // Load score from first live campaign participant data
  useEffect(() => {
    if (!wallet) return
    async function load() {
      try {
        const res = await fetch(`${API}/campaigns`)
        const campaigns = await res.json()
        if (!Array.isArray(campaigns) || campaigns.length === 0) return
        const first = campaigns.find((c: { status: string }) => c.status === 'live') || campaigns[0]
        const r2 = await fetch(`${API}/campaign?id=${first.id}&address=${wallet}`)
        const data = await r2.json()
        if (data.participant) setScoreData(data.participant)
      } catch {}
    }
    load()
  }, [wallet])

  function copyAddress() {
    navigator.clipboard.writeText(wallet).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const score = scoreData?.attribution_score || 0
  const multiplier = parseFloat(scoreData?.score_multiplier || '1').toFixed(1)
  const totalEarned = parseFloat(scoreData?.total_earned_usd || '0')
  const tier = score >= 80 ? 'Builder' : score >= 60 ? 'Contributor' : score >= 40 ? 'Participant' : 'Explorer'
  const avatarLetter = wallet ? wallet.charAt(2).toUpperCase() : '?'

  // Score dimension estimates (scale from total score)
  const dims = [
    Math.min(100, Math.round(score * 1.11)),
    Math.min(100, Math.round(score * 1.04)),
    Math.min(100, Math.round(score * 0.95)),
    Math.min(100, Math.round(score * 0.78)),
  ]

  return (
    <div className="p-wrap">
      {/* Header */}
      <div className="p-header">
        <div className="p-identity">
          <div className="p-avatar">
            {avatarLetter}
            {score > 0 && <div className="p-score-badge">{score}</div>}
          </div>
          <div className="p-info">
            <div className="p-name">
              {shortAddr(wallet)}
              {tier && <span className="p-name-badge">{tier} tier</span>}
            </div>
            <div className="p-addr">
              {wallet}
              <span className="p-addr-copy" onClick={copyAddress}>{copied ? 'copied!' : 'copy'}</span>
            </div>
            <div className="p-meta">
              <span className="p-meta-pill">📅 {scoreData?.active_trading_days || 0} active days</span>
              <span className="p-meta-pill">🔗 {scoreData ? Math.round(((scoreData.referral_bridge_points || 0) + (scoreData.referral_trade_points || 0)) / 60) : 0} referrals</span>
              <span className="p-meta-pill" style={{background:'#e8f0ff',color:'#0052FF'}}>{tier} tier</span>
            </div>
          </div>

          <div className="p-value-block">
            <div className="p-value-num">{totalEarned > 0 ? '$' + totalEarned.toFixed(2) : '—'}</div>
            <div style={{fontSize:11,color:'#aaa',marginTop:4}}>Attribution earnings</div>
          </div>
        </div>

        <div className="p-stats">
          <div className="p-stat-earnings">
            <span className="p-stat-label">Total earnings</span>
            <span className="p-stat-val">{totalEarned > 0 ? '$' + totalEarned.toFixed(2) : '—'}</span>
            <span className="p-stat-sub">{scoreData?.total_points ? scoreData.total_points.toLocaleString() + ' pts' : 'Join a campaign to earn'}</span>
          </div>
          <div className="p-stat"><span className="p-stat-label">Active days</span><span className="p-stat-val">{scoreData?.active_trading_days || 0}</span></div>
          <div className="p-stat"><span className="p-stat-label">Bridge pts</span><span className="p-stat-val">{scoreData?.bridge_points || 0}</span></div>
          <div className="p-stat"><span className="p-stat-label">Trade pts</span><span className="p-stat-val">{scoreData?.trading_points || 0}</span></div>
          <div className="p-stat"><span className="p-stat-label">Referral pts</span><span className="p-stat-val">{(scoreData?.referral_bridge_points || 0) + (scoreData?.referral_trade_points || 0)}</span></div>
          <div className="p-stat"><span className="p-stat-label">Multiplier</span><span className="p-stat-val">{multiplier}×</span></div>
          <div className="p-score-stat">
            <span className="p-stat-label">Attribution score</span>
            <span className="p-stat-val">{score > 0 ? score + ' / 1000' : '—'}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-tabs">
        {(['portfolio','score','badge'] as Tab[]).map(t => (
          <div key={t} className={`p-tab${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="p-body">

        {activeTab === 'portfolio' && (
          <>
            {/* Earnings panel */}
            <div className="p-earnings-panel">
              <div className="p-earnings-header">
                <div>
                  <div className="p-earnings-title">Attribution earnings</div>
                  <div className="p-earnings-total">{totalEarned > 0 ? '$' + totalEarned.toFixed(2) : '$0.00'}</div>
                  <div className="p-earnings-period">All time · from campaigns</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:11,color:'#16a34a',marginBottom:4}}>Score weight</div>
                  <div style={{fontSize:20,fontWeight:700,color:'#14532d',fontFamily:'DM Mono,monospace'}}>{multiplier}×</div>
                  <div style={{fontSize:10,color:'#16a34a',marginTop:2}}>score: {score} / 1000</div>
                </div>
              </div>
              <div className="p-earnings-grid">
                <div className="p-earning-type">
                  <div className="p-earning-type-label">Bridge rewards</div>
                  <div className="p-earning-type-val">{scoreData?.bridge_points ? scoreData.bridge_points + ' pts' : '—'}</div>
                  <div className="p-earning-type-sub">One-time action</div>
                  <div className="p-earning-bar"><div className="p-earning-bar-fill" style={{width: scoreData ? Math.min(100, Math.round(((scoreData.bridge_points||0) / Math.max(scoreData.total_points||1,1)) * 100)) + '%' : '0%'}} /></div>
                </div>
                <div className="p-earning-type">
                  <div className="p-earning-type-label">Trading rewards</div>
                  <div className="p-earning-type-val">{scoreData?.trading_points ? scoreData.trading_points + ' pts' : '—'}</div>
                  <div className="p-earning-type-sub">{scoreData?.active_trading_days || 0} trading days</div>
                  <div className="p-earning-bar"><div className="p-earning-bar-fill" style={{width: scoreData ? Math.min(100, Math.round(((scoreData.trading_points||0) / Math.max(scoreData.total_points||1,1)) * 100)) + '%' : '0%'}} /></div>
                </div>
                <div className="p-earning-type">
                  <div className="p-earning-type-label">Referral rewards</div>
                  <div className="p-earning-type-val">{scoreData ? ((scoreData.referral_bridge_points||0) + (scoreData.referral_trade_points||0)) + ' pts' : '—'}</div>
                  <div className="p-earning-type-sub">From referred wallets</div>
                  <div className="p-earning-bar"><div className="p-earning-bar-fill" style={{width: scoreData ? Math.min(100, Math.round((((scoreData.referral_bridge_points||0)+(scoreData.referral_trade_points||0)) / Math.max(scoreData.total_points||1,1)) * 100)) + '%' : '0%'}} /></div>
                </div>
              </div>
            </div>

            {/* Chains */}
            <div className="p-chains-grid">
              {CHAINS.map(c => (
                <div key={c.name} className="p-chain">
                  <div className="p-chain-dot" style={{background:c.bg,color:c.fg}}>{c.letter}</div>
                  <div><div className="p-chain-name">{c.name}</div><div className="p-chain-val">—</div></div>
                </div>
              ))}
            </div>

            <div style={{textAlign:'center',padding:'32px 0',color:'#aaa',fontSize:13}}>
              Portfolio data coming soon — connect to a data provider to see token balances and LP positions.
            </div>
          </>
        )}

        {activeTab === 'score' && (
          <div className="p-score-panel">
            <div className="p-score-panel-header">
              <span className="p-score-panel-title">Attribution score</span>
              <span className="p-score-tier">{tier} tier</span>
            </div>
            <div style={{display:'flex',alignItems:'flex-start',gap:20}}>
              <div>
                <div className="p-score-big">{score > 0 ? score : '—'}</div>
                <div style={{fontSize:11,color:'#aaa',marginTop:4,fontFamily:'DM Mono,monospace'}}>
                  {score > 0 ? `${multiplier}× reward weight` : 'Join a campaign to get scored'}
                </div>
              </div>
              <div style={{flex:1}}>
                <div className="p-score-dims">
                  {SCORE_DIMS.map((d, i) => (
                    <div key={d.key} className="p-dim">
                      <div className="p-dim-row">
                        <span className="p-dim-name">{d.name}</span>
                        <span className="p-dim-num">{dims[i] || '—'}</span>
                      </div>
                      <div className="p-dim-bar"><div className="p-dim-fill" style={{width:(dims[i]||0)+'%'}} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'badge' && (
          <div style={{textAlign:'center',padding:'64px 24px',color:'#aaa'}}>
            <div style={{fontSize:48,marginBottom:16}}>🏅</div>
            <div style={{fontSize:16,fontWeight:600,color:'#1a1a2e',marginBottom:8}}>{tier} tier</div>
            <div style={{fontSize:13,lineHeight:1.6,maxWidth:360,margin:'0 auto'}}>
              Your Attribution score of {score || '—'} places you in the {tier} tier. Keep earning to unlock higher tiers and multipliers.
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;background:#f5f5f0;color:#1a1a2e}
        .p-wrap{background:#fff;min-height:100vh}
        .p-header{padding:24px 28px 0;border-bottom:1px solid #eeeee8}
        .p-identity{display:flex;align-items:flex-start;gap:20px;padding-bottom:16px}
        .p-avatar{width:80px;height:80px;border-radius:16px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:700;color:#fff;flex-shrink:0;position:relative;border:2px solid #eeeee8;font-family:var(--font-mono),'DM Mono',monospace}
        .p-score-badge{position:absolute;bottom:0;right:0;background:#0052FF;color:#fff;font-family:var(--font-mono),'DM Mono',monospace;font-size:10px;font-weight:500;padding:3px 6px;border-radius:6px 0 0 0;letter-spacing:0}
        .p-info{flex:1;padding-top:2px}
        .p-name{font-size:21px;font-weight:700;color:#1a1a2e;letter-spacing:-0.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}
        .p-name-badge{font-size:10px;font-weight:600;background:#e8f0ff;color:#0052FF;padding:3px 8px;border-radius:20px;letter-spacing:0.3px;white-space:nowrap}
        .p-addr{font-family:var(--font-mono),'DM Mono',monospace;font-size:11px;color:#aaa;margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;overflow-wrap:anywhere}
        .p-addr-copy{background:#f0f0ec;border-radius:3px;padding:1px 5px;font-size:10px;cursor:pointer;color:#888;flex-shrink:0}
        .p-addr-copy:hover{color:#0052FF}
        .p-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .p-meta-pill{background:#f5f5f0;border-radius:6px;padding:3px 9px;font-size:11px;color:#666;display:flex;align-items:center;gap:4px}
        .p-value-block{text-align:right;min-width:140px;padding-top:2px;flex-shrink:0}
        .p-value-num{font-size:24px;font-weight:700;color:#1a1a2e;letter-spacing:-1px}
        .p-stats{display:flex;align-items:stretch;gap:0;border-top:1px solid #eeeee8;flex-wrap:nowrap;overflow-x:auto}
        .p-stat{display:flex;flex-direction:column;gap:2px;padding:12px 16px;border-right:1px solid #eeeee8;flex-shrink:0}
        .p-stat:last-child{border-right:none}
        .p-stat-label{font-size:11px;color:#bbb;white-space:nowrap}
        .p-stat-val{font-size:14px;font-weight:600;color:#1a1a2e;white-space:nowrap}
        .p-stat-earnings{background:#f0fdf4;border-right:1px solid #eeeee8;padding:12px 18px;display:flex;flex-direction:column;gap:2px;flex-shrink:0;border-top:2px solid #16a34a}
        .p-stat-earnings .p-stat-label{color:#16a34a}
        .p-stat-earnings .p-stat-val{font-size:17px;color:#14532d;font-family:var(--font-mono),'DM Mono',monospace;font-weight:600}
        .p-stat-earnings .p-stat-sub{font-size:10px;color:#16a34a;margin-top:1px}
        .p-score-stat{background:#f0f4ff;border-top:2px solid #0052FF;padding:12px 16px;display:flex;flex-direction:column;gap:2px;flex-shrink:0;border-right:1px solid #eeeee8}
        .p-score-stat .p-stat-label{color:#6b9fff}
        .p-score-stat .p-stat-val{color:#0052FF;font-size:15px;font-family:var(--font-mono),'DM Mono',monospace}
        .p-tabs{display:flex;gap:0;border-bottom:1px solid #eeeee8;padding:0 28px}
        .p-tab{padding:12px 20px;font-size:14px;font-weight:500;color:#aaa;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.15s}
        .p-tab:hover{color:#1a1a2e}
        .p-tab.active{color:#0052FF;border-bottom-color:#0052FF;font-weight:600}
        .p-body{padding:20px 28px}
        .p-earnings-panel{border:1px solid #bbf7d0;border-radius:12px;background:#f0fdf4;padding:16px 18px;margin-bottom:18px}
        .p-earnings-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px}
        .p-earnings-title{font-size:11px;font-weight:600;color:#16a34a;letter-spacing:1px;text-transform:uppercase}
        .p-earnings-total{font-size:28px;font-weight:700;color:#14532d;font-family:var(--font-mono),'DM Mono',monospace;letter-spacing:-1px}
        .p-earnings-period{font-size:11px;color:#16a34a;margin-top:2px}
        .p-earnings-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
        .p-earning-type{background:#fff;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px}
        .p-earning-type-label{font-size:11px;color:#aaa;margin-bottom:4px}
        .p-earning-type-val{font-size:15px;font-weight:700;color:#1a1a2e;font-family:var(--font-mono),'DM Mono',monospace}
        .p-earning-type-sub{font-size:10px;color:#bbb;margin-top:2px}
        .p-earning-bar{height:3px;background:#bbf7d0;border-radius:2px;overflow:hidden;margin-top:8px}
        .p-earning-bar-fill{height:100%;background:#16a34a;border-radius:2px}
        .p-score-panel{border:1px solid #d0deff;border-radius:12px;background:#f7f9ff;padding:16px 18px;margin-bottom:18px}
        .p-score-panel-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
        .p-score-panel-title{font-size:11px;font-weight:600;color:#0052FF;letter-spacing:1px;text-transform:uppercase}
        .p-score-tier{font-size:11px;color:#fff;background:#0052FF;padding:3px 10px;border-radius:20px;font-weight:600}
        .p-score-big{font-size:38px;font-weight:700;color:#0052FF;font-family:var(--font-mono),'DM Mono',monospace;letter-spacing:-1px;line-height:1}
        .p-score-dims{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
        .p-dim{display:flex;flex-direction:column;gap:4px}
        .p-dim-row{display:flex;justify-content:space-between}
        .p-dim-name{font-size:11px;color:#888}
        .p-dim-num{font-size:11px;font-weight:600;color:#0052FF;font-family:var(--font-mono),'DM Mono',monospace}
        .p-dim-bar{height:3px;background:#dce8ff;border-radius:2px;overflow:hidden}
        .p-dim-fill{height:100%;background:#0052FF;border-radius:2px}
        .p-chains-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:0;margin-bottom:16px;border:1px solid #eeeee8;border-radius:12px;overflow:hidden}
        .p-chain{display:flex;align-items:center;gap:8px;padding:12px;border-right:1px solid #eeeee8;cursor:pointer;transition:background 0.1s}
        .p-chain:hover{background:#f9f9f6}
        .p-chain:last-child{border-right:none}
        .p-chain-dot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;font-weight:700}
        .p-chain-name{font-size:12px;font-weight:600;color:#1a1a2e}
        .p-chain-val{font-size:11px;color:#aaa}
        @media(max-width:640px){
          .p-identity{flex-wrap:wrap}
          .p-value-block{min-width:0;width:100%}
          .p-stats{flex-wrap:nowrap}
          .p-chains-grid{grid-template-columns:repeat(3,1fr)}
          .p-earnings-grid{grid-template-columns:1fr}
          .p-score-dims{grid-template-columns:1fr}
          .p-body{padding:16px}
          .p-header{padding:16px 16px 0}
          .p-tabs{padding:0 16px}
        }
      `}</style>
      <MwNav />
      <MwAuthGuard>
        <ProfileContent />
      </MwAuthGuard>
    </>
  )
}

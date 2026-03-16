'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState } from 'react'
import { API, shortAddr } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Signal {
  key: string
  name: string
  icon: string
  max: number
  color: string
  score: number
  insights: string[]
}

interface ScoreResponse {
  address: string
  score: number
  tier: string
  percentile: number
  signals: Signal[]
  walletAge: string
  firstSeen: string
  chains: number
  totalTxCount: number
  treeSize: number
  treeQuality: string
  character: { label: string; color: string; desc: string; icon: string }
  uvOpportunities: {
    name: string; cat: string; icon: string
    type: string; typeColor: string; accentColor: string
    mechanic: string; lo: number; hi: number; reason: string
  }[]
  totalLo: number
  totalHi: number
}

type Tab = 'portfolio' | 'score' | 'badge'

// ─── Profile content ──────────────────────────────────────────────────────────
function ProfileContent() {
  const { address } = useAccount()
  const wallet = address?.toLowerCase() ?? ''
  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [data, setData] = useState<ScoreResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!wallet) return
    setLoading(true)
    fetch(`${API}/score?address=${wallet}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [wallet])

  function copyAddress() {
    navigator.clipboard.writeText(wallet).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const score = data?.score ?? 0
  const tier = data?.tier ? data.tier.charAt(0).toUpperCase() + data.tier.slice(1) : '—'
  const avatarLetter = wallet ? wallet.charAt(2).toUpperCase() : '?'
  const maxScore = data?.signals?.reduce((s, sig) => s + sig.max, 0) ?? 925

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
              {data && <span className="p-name-badge">{tier} tier</span>}
            </div>
            <div className="p-addr">
              {wallet}
              <span className="p-addr-copy" onClick={copyAddress}>{copied ? 'copied!' : 'copy'}</span>
            </div>
            <div className="p-meta">
              {data?.walletAge && <span className="p-meta-pill">📅 {data.walletAge} old</span>}
              {data?.chains != null && <span className="p-meta-pill">🔗 {data.chains} chains</span>}
              {data?.totalTxCount != null && <span className="p-meta-pill">⚡ {data.totalTxCount} txns</span>}
              {data?.percentile != null && <span className="p-meta-pill" style={{background:'#e8f0ff',color:'#0052FF'}}>top {100 - data.percentile}%</span>}
            </div>
          </div>

          <div className="p-value-block">
            {data ? (
              <>
                <div className="p-value-num">${data.totalLo.toLocaleString()}–${data.totalHi.toLocaleString()}</div>
                <div style={{fontSize:11,color:'#aaa',marginTop:4}}>Estimated annual earnings</div>
              </>
            ) : loading ? (
              <div style={{fontSize:13,color:'#bbb'}}>Loading…</div>
            ) : null}
          </div>
        </div>

        <div className="p-stats">
          <div className="p-score-stat">
            <span className="p-stat-label">Attribution score</span>
            <span className="p-stat-val">{score > 0 ? `${score} / ${maxScore}` : '—'}</span>
          </div>
          <div className="p-stat">
            <span className="p-stat-label">Percentile</span>
            <span className="p-stat-val">{data ? `${data.percentile}th` : '—'}</span>
          </div>
          <div className="p-stat">
            <span className="p-stat-label">First seen</span>
            <span className="p-stat-val">{data?.firstSeen ?? '—'}</span>
          </div>
          <div className="p-stat">
            <span className="p-stat-label">Chains</span>
            <span className="p-stat-val">{data?.chains ?? '—'}</span>
          </div>
          <div className="p-stat">
            <span className="p-stat-label">Network size</span>
            <span className="p-stat-val">{data?.treeSize ?? 0} wallets</span>
          </div>
          <div className="p-stat">
            <span className="p-stat-label">Character</span>
            <span className="p-stat-val" style={{color: data?.character?.color}}>{data?.character?.icon} {data?.character?.label ?? '—'}</span>
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
            {loading && <div style={{textAlign:'center',padding:'40px 0',color:'#bbb',fontSize:13}}>Loading score data…</div>}

            {!loading && data && data.uvOpportunities?.length > 0 && (
              <div style={{marginBottom:18}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'1px',textTransform:'uppercase',color:'#0052FF',marginBottom:12}}>
                  Earning opportunities for your wallet
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {data.uvOpportunities.map((op, i) => (
                    <div key={i} className="p-opp">
                      <div className="p-opp-icon" style={{background: op.accentColor + '18', color: op.accentColor}}>{op.icon}</div>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                          <span style={{fontSize:14,fontWeight:700,color:'#1a1a2e'}}>{op.name}</span>
                          <span style={{fontSize:10,color:'#aaa'}}>{op.cat}</span>
                          <span style={{fontSize:9,fontWeight:700,letterSpacing:'0.5px',textTransform:'uppercase',color:op.typeColor,background:op.typeColor+'18',padding:'2px 6px',borderRadius:4}}>{op.type}</span>
                        </div>
                        <div style={{fontSize:11,color:'#888',marginBottom:4}}>{op.mechanic}</div>
                        <div style={{fontSize:11,color:'#555',lineHeight:1.5}} dangerouslySetInnerHTML={{__html: op.reason}} />
                      </div>
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:'#16a34a',fontFamily:'DM Mono,monospace'}}>${op.lo}–${op.hi}</div>
                        <div style={{fontSize:10,color:'#aaa',marginTop:2}}>est. / yr</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loading && !data && (
              <div style={{textAlign:'center',padding:'40px 0',color:'#aaa',fontSize:13}}>
                Could not load score data. The API may be indexing your wallet.
              </div>
            )}
          </>
        )}

        {activeTab === 'score' && (
          <div className="p-score-panel">
            <div className="p-score-panel-header">
              <span className="p-score-panel-title">Attribution score</span>
              <span className="p-score-tier">{tier} tier</span>
            </div>

            {loading && <div style={{textAlign:'center',padding:'24px 0',color:'#bbb',fontSize:13}}>Loading…</div>}

            {data && (
              <>
                <div style={{display:'flex',alignItems:'flex-start',gap:24,marginBottom:20}}>
                  <div>
                    <div className="p-score-big">{score}</div>
                    <div style={{fontSize:11,color:'#aaa',marginTop:4,fontFamily:'DM Mono,monospace'}}>
                      of {maxScore} max · {data.percentile}th percentile
                    </div>
                  </div>
                  {data.character && (
                    <div style={{flex:1,background:'#f9f9f6',border:'1px solid #eee',borderRadius:10,padding:'10px 14px'}}>
                      <div style={{fontSize:11,color:'#aaa',marginBottom:4}}>Wallet character</div>
                      <div style={{fontSize:14,fontWeight:700,color:data.character.color,marginBottom:4}}>{data.character.icon} {data.character.label}</div>
                      <div style={{fontSize:12,color:'#666',lineHeight:1.5}}>{data.character.desc}</div>
                    </div>
                  )}
                </div>

                <div className="p-score-dims">
                  {data.signals.map(sig => (
                    <div key={sig.key} className="p-dim">
                      <div className="p-dim-row">
                        <span className="p-dim-name">{sig.icon} {sig.name}</span>
                        <span className="p-dim-num" style={{color:sig.color}}>{sig.score} / {sig.max}</span>
                      </div>
                      <div className="p-dim-bar">
                        <div className="p-dim-fill" style={{width: Math.round((sig.score/sig.max)*100)+'%', background:sig.color}} />
                      </div>
                      {sig.insights?.length > 0 && (
                        <div style={{fontSize:10,color:'#999',marginTop:4,lineHeight:1.5}}>
                          {sig.insights[0]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'badge' && (
          <div style={{textAlign:'center',padding:'48px 24px',color:'#aaa'}}>
            {data ? (
              <>
                <div style={{fontSize:52,marginBottom:12}}>{data.character?.icon ?? '🏅'}</div>
                <div style={{fontSize:18,fontWeight:700,color:data.character?.color ?? '#1a1a2e',marginBottom:6}}>
                  {data.character?.label ?? tier}
                </div>
                <div style={{fontSize:13,color:'#888',marginBottom:16}}>{tier} tier · {data.percentile}th percentile</div>
                <div style={{fontSize:13,lineHeight:1.7,maxWidth:380,margin:'0 auto 24px',color:'#666'}}>
                  {data.character?.desc}
                </div>
                <div style={{display:'inline-flex',gap:20,background:'#f9f9f6',border:'1px solid #eee',borderRadius:12,padding:'14px 24px'}}>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:700,color:'#0052FF',fontFamily:'DM Mono,monospace'}}>{score}</div>
                    <div style={{fontSize:10,color:'#aaa',marginTop:2}}>Score</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:700,color:'#1a1a2e'}}>{data.chains}</div>
                    <div style={{fontSize:10,color:'#aaa',marginTop:2}}>Chains</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:700,color:'#1a1a2e'}}>{data.treeSize}</div>
                    <div style={{fontSize:10,color:'#aaa',marginTop:2}}>Network</div>
                  </div>
                </div>
              </>
            ) : loading ? (
              <div style={{fontSize:13}}>Loading…</div>
            ) : (
              <div style={{fontSize:13}}>Could not load badge data.</div>
            )}
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
        .p-value-block{text-align:right;min-width:160px;padding-top:2px;flex-shrink:0}
        .p-value-num{font-size:20px;font-weight:700;color:#16a34a;letter-spacing:-0.5px;font-family:var(--font-mono),'DM Mono',monospace}
        .p-stats{display:flex;align-items:stretch;gap:0;border-top:1px solid #eeeee8;flex-wrap:nowrap;overflow-x:auto}
        .p-stat{display:flex;flex-direction:column;gap:2px;padding:12px 16px;border-right:1px solid #eeeee8;flex-shrink:0}
        .p-stat:last-child{border-right:none}
        .p-stat-label{font-size:11px;color:#bbb;white-space:nowrap}
        .p-stat-val{font-size:14px;font-weight:600;color:#1a1a2e;white-space:nowrap}
        .p-score-stat{background:#f0f4ff;border-top:2px solid #0052FF;padding:12px 16px;display:flex;flex-direction:column;gap:2px;flex-shrink:0;border-right:1px solid #eeeee8}
        .p-score-stat .p-stat-label{color:#6b9fff}
        .p-score-stat .p-stat-val{color:#0052FF;font-size:15px;font-family:var(--font-mono),'DM Mono',monospace}
        .p-tabs{display:flex;gap:0;border-bottom:1px solid #eeeee8;padding:0 28px}
        .p-tab{padding:12px 20px;font-size:14px;font-weight:500;color:#aaa;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.15s}
        .p-tab:hover{color:#1a1a2e}
        .p-tab.active{color:#0052FF;border-bottom-color:#0052FF;font-weight:600}
        .p-body{padding:20px 28px}
        .p-opp{display:flex;align-items:flex-start;gap:14px;padding:14px;border:1px solid #eeeee8;border-radius:10px;transition:border-color 0.15s;background:#fff}
        .p-opp:hover{border-color:#0052FF}
        .p-opp-icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
        .p-score-panel{border:1px solid #d0deff;border-radius:12px;background:#f7f9ff;padding:16px 18px;margin-bottom:18px}
        .p-score-panel-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
        .p-score-panel-title{font-size:11px;font-weight:600;color:#0052FF;letter-spacing:1px;text-transform:uppercase}
        .p-score-tier{font-size:11px;color:#fff;background:#0052FF;padding:3px 10px;border-radius:20px;font-weight:600}
        .p-score-big{font-size:42px;font-weight:700;color:#0052FF;font-family:var(--font-mono),'DM Mono',monospace;letter-spacing:-1px;line-height:1}
        .p-score-dims{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:4px}
        .p-dim{display:flex;flex-direction:column;gap:5px}
        .p-dim-row{display:flex;justify-content:space-between}
        .p-dim-name{font-size:12px;color:#555;font-weight:500}
        .p-dim-num{font-size:12px;font-weight:600;font-family:var(--font-mono),'DM Mono',monospace}
        .p-dim-bar{height:4px;background:#e8eeff;border-radius:2px;overflow:hidden}
        .p-dim-fill{height:100%;border-radius:2px;transition:width 0.6s ease}
        @media(max-width:640px){
          .p-identity{flex-wrap:wrap}
          .p-value-block{min-width:0;width:100%;text-align:left}
          .p-stats{flex-wrap:nowrap}
          .p-score-dims{grid-template-columns:1fr}
          .p-body{padding:16px}
          .p-header{padding:16px 16px 0}
          .p-tabs{padding:0 16px}
          .p-opp{flex-wrap:wrap}
        }
      `}</style>
      <MwNav />
      <MwAuthGuard>
        <ProfileContent />
      </MwAuthGuard>
    </>
  )
}

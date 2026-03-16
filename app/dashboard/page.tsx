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
function actionTagClass(key: string): string {
  const base = 'text-[11px] font-semibold py-[3px] px-2.5 rounded-full border whitespace-nowrap'
  if (key.startsWith('referral')) return `${base} text-[#7C3AED] border-[rgba(124,58,237,0.2)] bg-[rgba(124,58,237,0.06)]`
  if (key === 'bridge') return `${base} text-mw-brand border-[rgba(0,82,255,0.2)] bg-mw-brand-dim`
  if (key === 'trade') return `${base} text-mw-green border-mw-green-edge bg-mw-green-muted`
  if (key === 'hold') return `${base} text-[#B45309] border-[rgba(180,83,9,0.2)] bg-[rgba(251,191,36,0.08)]`
  return `${base} text-mw-ink-3 border-mw-border-strong bg-mw-surface`
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
    <div className={`bg-white border border-mw-border rounded-[18px] px-6 py-[22px] transition-all duration-150 shadow-[0_2px_12px_rgba(26,26,46,0.04)] hover:border-mw-border-strong hover:shadow-md hover:-translate-y-px${isLive ? ' border-l-[3px] border-l-mw-brand' : ' opacity-75'}`}>
      <div className="flex items-start gap-4 max-[720px]:flex-wrap">
        <div className="w-[46px] h-[46px] rounded-xl flex items-center justify-center text-lg font-bold shrink-0" style={{background: col.bg, color: col.fg}}>{initial}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-[15px] font-bold text-mw-ink">{c.name}</div>
            {isLive
              ? <div className="inline-flex items-center gap-[5px] bg-mw-green-muted border border-mw-green-edge rounded-full py-px px-2 text-[10px] font-bold text-mw-green"><span className="w-[5px] h-[5px] rounded-full bg-mw-green animate-pulse-slow" />Live</div>
              : <div className="bg-[rgba(26,26,46,0.05)] border border-mw-border-strong rounded-full py-px px-2 text-[10px] font-bold text-mw-ink-3">Upcoming</div>}
          </div>
          <div className="text-xs text-mw-ink-3 font-[var(--font-mono),'DM_Mono',monospace] mb-3">{sub}</div>
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(c.actions || {}).map(([key, action]) => {
              const suffix = action.per_day ? '/day' : action.one_time ? '' : action.per_referral ? '/ref' : ''
              const labelWord = action.label.split(' ')[0].toLowerCase()
              return <span key={key} className={actionTagClass(key)}>+{action.points} {labelWord}{suffix}</span>
            })}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2.5 shrink-0 ml-4 max-[720px]:flex-row max-[720px]:items-center max-[720px]:ml-0 max-[720px]:w-full max-[720px]:justify-between">
          <div>
            <div className="font-[var(--font-mono),'DM_Mono',monospace] text-[15px] font-medium text-mw-ink whitespace-nowrap text-right">{poolDisplay}</div>
            <div className="text-[11px] text-mw-ink-3 text-right">{dailyDisplay} payout</div>
          </div>
          {isLive
            ? <button className="px-[22px] py-[9px] rounded-[10px] text-[13px] font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-all duration-150 whitespace-nowrap bg-mw-brand text-white border-none hover:bg-[#0040cc]" onClick={() => router.push(`/campaign/${c.id}`)}>Earn now</button>
            : <button className="px-[22px] py-[9px] rounded-[10px] text-[13px] font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-all duration-150 whitespace-nowrap bg-transparent text-mw-ink-3 border border-mw-border-strong hover:border-mw-brand hover:text-mw-brand">Join waitlist</button>}
        </div>
      </div>
      {isLive && (
        <div className="mt-4 pt-3.5 border-t border-mw-border flex items-center gap-3.5">
          <span className="text-[11px] text-mw-ink-3 whitespace-nowrap">
            {wallet && participant ? 'Your eligibility' : 'Score required'}
          </span>
          <div className="flex-1 h-1 bg-mw-border rounded-sm overflow-hidden">
            {wallet && participant ? (
              <div className="h-full rounded-sm" style={{
                width: Math.min(100, Math.round((score/1000)*100)) + '%',
                background: score >= minScore ? '#0052FF' : '#f97316'
              }} />
            ) : (
              <div className="h-full rounded-sm" style={{width:'0%', background:'rgba(26,26,46,0.13)'}} />
            )}
          </div>
          {wallet && participant ? (
            <>
              <span className="font-[var(--font-mono),'DM_Mono',monospace] text-[11px] text-mw-brand whitespace-nowrap">{score} / 1000</span>
              {score >= minScore
                ? <span className="text-[11px] font-semibold text-mw-green bg-mw-green-muted border border-mw-green-edge rounded-full px-2 py-px whitespace-nowrap">{mult}× weight</span>
                : <span className="text-[11px] font-semibold rounded-full px-2 py-px whitespace-nowrap" style={{color:'#B45309', background:'rgba(251,191,36,0.08)', borderWidth:1, borderStyle:'solid', borderColor:'rgba(180,83,9,0.2)'}}>Min {minScore} req.</span>}
            </>
          ) : (
            <span className="font-[var(--font-mono),'DM_Mono',monospace] text-[11px] whitespace-nowrap text-mw-ink-3">Need {minScore}+</span>
          )}
        </div>
      )}
      {isLive && participant && (participant.total_points || participant.total_earned_usd) && (
        <div className="mt-3.5 pt-3.5 border-t border-mw-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-mw-ink-3">Your progress this campaign</span>
            <span className="text-[11px] font-semibold text-mw-ink font-[var(--font-mono),'DM_Mono',monospace]">{(participant.total_points||0).toLocaleString()} pts · ${parseFloat(participant.total_earned_usd||'0').toFixed(2)} earned</span>
          </div>
          <div className="h-1 bg-mw-border rounded-sm overflow-hidden">
            <div className="h-full rounded-sm bg-gradient-to-r from-mw-brand to-[#7C3AED]" style={{width: Math.min(100, Math.round(((participant.total_points||0)/1000)*100)) + '%'}} />
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
      sessionStorage.setItem('mw_referrer', ref.toLowerCase())
    }
  }, [searchParams])

  // Load Attribution score from /score endpoint
  const loadScore = useCallback(async () => {
    if (!wallet) return
    try {
      const res = await fetch(`${API}/score?address=${wallet}`)
      if (!res.ok) return
      const data = await res.json()
      setScoreNum(data.score ?? null)
    } catch {}
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
    const multiplier = parseFloat(firstParticipant?.score_multiplier || '1').toFixed(1)

    setScoreMeta(activeCount
      ? `Active in ${activeCount} campaign${activeCount > 1 ? 's' : ''} · ${Object.values(pData).reduce((s,p) => s + (p.total_points||0), 0).toLocaleString()} total points`
      : 'No active campaigns yet — join one below')
    setScoreWeight(`⚡ ${multiplier}× reward weight`)
    setStatCampaigns(String(activeCount || 0))
    setStatEarned(totalEarned > 0 ? '$' + totalEarned.toFixed(0) : '$0')
    setRefCount('—')
  }, [wallet])

  useEffect(() => {
    if (wallet) loadScore()
  }, [wallet, loadScore])

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
    <div className="max-w-[960px] mx-auto px-12 pt-11 pb-20 max-[720px]:px-5 max-[720px]:pt-6 max-[720px]:pb-[60px]">
      {error && <div className="bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.18)] rounded-xl px-4 py-3 text-[13px] text-red-600 mb-4">{error}</div>}

      {/* Score Banner */}
      <div className="mw-grid-overlay mw-glow-tr bg-mw-ink rounded-[20px] px-8 py-7 flex items-center gap-7 animate-fade-up mb-3 max-[720px]:flex-wrap">
        <div className="w-[76px] h-[76px] rounded-full border-2 border-mw-brand flex items-center justify-center shrink-0 bg-[rgba(0,82,255,0.08)] relative z-[1]">
          <div className="font-[Georgia,serif] text-[28px] font-bold text-mw-brand tracking-[-1px] leading-none">{scoreNum ?? '—'}</div>
        </div>
        <div className="flex-1 relative z-[1]">
          <div className="text-[15px] font-semibold text-[rgba(255,255,255,0.88)] mb-[5px]">Your Attribution Score</div>
          <div className="text-xs text-[rgba(255,255,255,0.38)] font-[var(--font-mono),'DM_Mono',monospace] mb-3">{scoreMeta}</div>
          <div className="inline-flex items-center gap-1.5 bg-[rgba(0,82,255,0.15)] border border-[rgba(0,82,255,0.3)] rounded-full px-3 py-1 text-xs font-semibold text-[#6b9fff]">{scoreWeight}</div>
        </div>
        <div className="w-px bg-[rgba(255,255,255,0.08)] self-stretch mx-1 shrink-0 relative z-[1]" />
        <div className="flex gap-7 shrink-0 relative z-[1]">
          <div className="text-center min-w-[52px]">
            <div className="font-[Georgia,serif] text-[22px] font-bold text-[rgba(255,255,255,0.88)] tracking-[-0.5px]">{statCampaigns}</div>
            <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-[rgba(255,255,255,0.25)] mt-[3px]">Campaigns</div>
          </div>
          <div className="text-center min-w-[52px]">
            <div className="font-[Georgia,serif] text-[22px] font-bold text-[rgba(255,255,255,0.88)] tracking-[-0.5px]">{refCount}</div>
            <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-[rgba(255,255,255,0.25)] mt-[3px]">Referrals</div>
          </div>
          <div className="text-center min-w-[52px]">
            <div className="font-[Georgia,serif] text-[22px] font-bold text-[#4ade80] tracking-[-0.5px]">{statEarned}</div>
            <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-[rgba(255,255,255,0.25)] mt-[3px]">Earned</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-5 [animation:fadeUp_0.5s_0.12s_ease_both]">
        {['All','Live','Bitcoin DeFi','Eligible'].map(f => (
          <button
            key={f}
            className={`px-4 py-1.5 rounded-full border text-[13px] font-medium cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-all duration-150 hover:border-mw-brand hover:text-mw-brand hover:bg-mw-brand-dim${currentFilter === f ? ' bg-mw-ink text-white border-mw-ink' : ' border-mw-border-strong bg-white text-mw-ink-3'}`}
            onClick={() => setCurrentFilter(f)}
          >{f === 'Eligible' ? 'Eligible for me' : f}</button>
        ))}
      </div>

      {/* Campaign list */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-mw-ink-3">Active campaigns</span>
        <span className="text-xs text-mw-ink-3 font-[var(--font-mono),'DM_Mono',monospace]">{loading ? 'Loading…' : filtered.length === 0 ? 'No campaigns' : `${filtered.length} campaign${filtered.length !== 1 ? 's' : ''}`}</span>
      </div>

      <div className="flex flex-col gap-2.5 [animation:fadeUp_0.5s_0.16s_ease_both] mb-8">
        {loading ? (
          <>
            <div className="mw-shimmer bg-white border border-mw-border rounded-2xl px-6 py-[22px] min-h-[110px]">
              <div className="h-3.5 rounded-md bg-mw-border mb-2.5 w-[65%]" />
              <div className="h-3.5 rounded-md bg-mw-border mb-2.5 w-[40%]" />
            </div>
            <div className="mw-shimmer bg-white border border-mw-border rounded-2xl px-6 py-[22px] min-h-[110px]">
              <div className="h-3.5 rounded-md bg-mw-border mb-2.5 w-[65%]" />
              <div className="h-3.5 rounded-md bg-mw-border mb-2.5 w-[40%]" />
            </div>
          </>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 px-6 text-mw-ink-3">
            <div className="text-[36px] mb-3">🔍</div>
            <div className="text-sm">No campaigns match this filter</div>
          </div>
        ) : filtered.map(c => (
          <CampaignCard key={c.id} c={c} wallet={wallet} participant={participantData[c.id]} />
        ))}
      </div>

      {/* Referral Box */}
      <div className="mw-grid-overlay mw-glow-br bg-mw-ink rounded-[20px] px-8 py-7 [animation:fadeUp_0.5s_0.28s_ease_both]">
        <div className="flex items-start justify-between gap-6 mb-5 max-[720px]:flex-col">
          <div>
            <div className="text-base font-semibold text-[rgba(255,255,255,0.88)] mb-1.5 relative z-[1]">Your referral link</div>
            <div className="text-[13px] text-[rgba(255,255,255,0.38)] leading-[1.55] max-w-[440px] relative z-[1]">Every wallet you refer that earns on any campaign adds permanently to your Attribution score — and earns you a share of their rewards, forever.</div>
          </div>
          <div className="flex gap-3 shrink-0 max-[720px]:w-full relative z-[1]">
            <div className="text-center bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-xl px-5 py-3">
              <div className="font-[Georgia,serif] text-xl font-bold text-[rgba(255,255,255,0.88)] tracking-[-0.5px]">{refCount}</div>
              <div className="text-[10px] font-bold tracking-[1px] uppercase text-[rgba(255,255,255,0.25)] mt-[3px]">Referred</div>
            </div>
            <div className="text-center bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-xl px-5 py-3">
              <div className="font-[Georgia,serif] text-xl font-bold text-[#4ade80] tracking-[-0.5px]">—</div>
              <div className="text-[10px] font-bold tracking-[1px] uppercase text-[rgba(255,255,255,0.25)] mt-[3px]">From refs</div>
            </div>
          </div>
        </div>
        <div className="flex gap-2.5 items-center relative z-[1]">
          <input className="flex-1 px-4 py-[11px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded-[10px] font-[var(--font-mono),'DM_Mono',monospace] text-[13px] text-[rgba(255,255,255,0.6)] outline-none" type="text" value={refLink || 'Loading your link…'} readOnly />
          <button className="px-[22px] py-[11px] rounded-[10px] bg-mw-brand text-white border-none text-[13px] font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-colors duration-150 whitespace-nowrap hover:bg-[#0040cc]" onClick={copyReferralLink}>{copiedRef ? 'Copied ✓' : 'Copy link'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
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

'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
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
    bridge:          { icon:'🌉', bg:'rgba(0,82,255,0.07)',      desc:'Bridge assets to this chain. One-time action.' },
    trade:           { icon:'📈', bg:'#f0fdf4',                  desc:'Trade each day to earn points. Repeatable daily.' },
    referral_bridge: { icon:'🔗', bg:'rgba(124,58,237,0.08)',    desc:'Share your bridge link. Earn when they bridge.' },
    referral_trade:  { icon:'↗',  bg:'rgba(194,83,122,0.08)',    desc:'Earn every time your referral trades.' },
  }
  return map[key] || { icon:'⚡', bg:'#F7F6FF', desc:'' }
}

const avatarColors = [
  { bg:'rgba(180,83,9,0.1)',    fg:'#B45309' },
  { bg:'rgba(26,26,46,0.06)',   fg:'#3A3C52' },
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
    <div className="bg-white border border-mw-border rounded-2xl p-[22px] mb-4 last:mb-0 [animation:fadeUp_0.5s_0.14s_ease_both]">
      <div className="text-[13px] font-bold text-mw-ink mb-3.5">Next payout in</div>
      {/* time-ring */}
      <div className="flex flex-col items-center py-2 pb-4">
        {/* time-units */}
        <div className="flex gap-4 justify-center">
          {/* time-unit */}
          <div className="text-center">
            <div className="font-[Georgia,serif] text-[28px] font-bold text-mw-ink tracking-[-1px] leading-none">{time.h}</div>
            <div className="text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-3 mt-1">Hours</div>
          </div>
          {/* time-sep */}
          <div className="font-[Georgia,serif] text-2xl text-mw-border-strong leading-none mt-1">:</div>
          {/* time-unit */}
          <div className="text-center">
            <div className="font-[Georgia,serif] text-[28px] font-bold text-mw-ink tracking-[-1px] leading-none">{time.m}</div>
            <div className="text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-3 mt-1">Mins</div>
          </div>
          {/* time-sep */}
          <div className="font-[Georgia,serif] text-2xl text-mw-border-strong leading-none mt-1">:</div>
          {/* time-unit */}
          <div className="text-center">
            <div className="font-[Georgia,serif] text-[28px] font-bold text-mw-ink tracking-[-1px] leading-none">{time.s}</div>
            <div className="text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-3 mt-1">Secs</div>
          </div>
        </div>
      </div>
      {/* time-bar */}
      <div className="mt-4 h-1 bg-mw-border rounded-sm overflow-hidden">
        <div className="h-full bg-gradient-to-r from-mw-brand to-[#7C3AED] rounded-sm" style={{width: time.pct + '%'}} />
      </div>
      <div className="text-[11px] text-mw-ink-3 text-center mt-2.5">
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
      const referrer = sessionStorage.getItem('mw_referrer') || null
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
      // page
      <div className="max-w-[960px] mx-auto px-12 pt-10 pb-20 max-[760px]:px-5 max-[760px]:pt-6 max-[760px]:pb-[60px]">
        {/* page-loader */}
        <div className="text-center py-20 px-6 text-mw-ink-3">
          <div className="text-[32px] mb-3">⚠️</div>
          <div className="text-[15px]">
            Could not load campaign.<br />
            <Link href="/dashboard" className="text-mw-brand">← Back to campaigns</Link>
          </div>
        </div>
      </div>
    )
  }

  if (!campaign) {
    return (
      // page
      <div className="max-w-[960px] mx-auto px-12 pt-10 pb-20 max-[760px]:px-5 max-[760px]:pt-6 max-[760px]:pb-[60px]">
        {/* page-loader */}
        <div className="text-center py-20 px-6 text-mw-ink-3">
          <div className="text-[32px] mb-3">⏳</div>
          <div className="text-[15px]">Loading campaign…</div>
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
    // page
    <div className="max-w-[960px] mx-auto px-12 pt-10 pb-20 max-[760px]:px-5 max-[760px]:pt-6 max-[760px]:pb-[60px]">

      {/* breadcrumb */}
      <div className="flex items-center gap-2 mb-7 animate-fade-up">
        <Link href="/dashboard" className="text-[13px] text-mw-ink-3 no-underline transition-colors duration-150 hover:text-mw-ink">Earn</Link>
        <span className="text-[13px] text-mw-border-strong">›</span>
        <span className="text-[13px] text-mw-ink font-medium">{c.name}</span>
      </div>

      {/* Campaign Hero — two glows implemented as child divs since we can't use both ::before and ::after */}
      <div className="bg-mw-ink rounded-[20px] p-8 mb-3 relative overflow-hidden animate-fade-up">
        {/* orange glow — top-right */}
        <div className="absolute top-[-60px] right-[-60px] w-[280px] h-[280px] rounded-full bg-[radial-gradient(circle,rgba(249,115,22,0.12)_0%,transparent_65%)] pointer-events-none" />
        {/* blue glow — bottom-left */}
        <div className="absolute bottom-[-40px] left-[-40px] w-[200px] h-[200px] rounded-full bg-[radial-gradient(circle,rgba(0,82,255,0.1)_0%,transparent_65%)] pointer-events-none" />

        {/* hero-top */}
        <div className="flex items-start gap-5 mb-6 relative">
          {/* hero-icon */}
          <div
            className="w-14 h-14 rounded-[14px] flex items-center justify-center text-[22px] font-bold shrink-0"
            style={{ background: col.bg, color: col.fg }}
          >
            {initial}
          </div>
          {/* hero-head */}
          <div className="flex-1">
            {/* hero-name-row */}
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="font-[Georgia,serif] text-[26px] font-bold text-[rgba(255,255,255,0.92)] tracking-[-0.5px]">{c.name}</div>
              {isLive ? (
                <div className="inline-flex items-center gap-[5px] bg-[rgba(22,163,74,0.15)] border border-[rgba(22,163,74,0.3)] rounded-full px-2.5 py-[3px] text-[11px] font-bold text-[#4ade80]">
                  <span className="w-[5px] h-[5px] rounded-full bg-[#4ade80] animate-pulse-slow" />
                  Live
                </div>
              ) : (
                <div className="bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.12)] rounded-full px-2.5 py-[3px] text-[11px] font-bold text-[rgba(255,255,255,0.4)]">
                  Upcoming
                </div>
              )}
            </div>
            {/* hero-sub */}
            <div className="text-[13px] text-[rgba(255,255,255,0.38)] font-[var(--font-mono),'DM_Mono',monospace] mb-3">
              {c.chain}{daysLeft !== null ? ` · Ends in ${daysLeft} days` : ''}{c.protocol ? ` · ${c.protocol}` : ''}
            </div>
            {/* hero-desc */}
            <div className="text-sm text-[rgba(255,255,255,0.55)] leading-[1.6] max-w-[520px]">
              {c.name} rewards {actionCount} activities — bridge, trade, and invite others. All activity earns points. Every 24 hours, a portion of the {fmtUSD(c.pool_usd)} {c.token_symbol} pool distributes to all active participants, weighted by that day&apos;s score.
            </div>
          </div>
        </div>

        {/* hero-stats */}
        <div className="grid grid-cols-4 gap-px bg-[rgba(255,255,255,0.06)] rounded-[14px] overflow-hidden relative max-[760px]:grid-cols-2">
          <div className="bg-[rgba(255,255,255,0.03)] px-5 py-[18px] text-center">
            <div className="font-[Georgia,serif] text-[22px] font-bold tracking-[-0.5px] mb-1 text-[#fb923c]">{fmtUSD(c.pool_usd)}</div>
            <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-[rgba(255,255,255,0.25)]">Total pool</div>
          </div>
          <div className="bg-[rgba(255,255,255,0.03)] px-5 py-[18px] text-center">
            <div className="font-[Georgia,serif] text-[22px] font-bold tracking-[-0.5px] mb-1 text-[#6b9fff]">{fmtUSD(c.daily_payout_usd)}</div>
            <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-[rgba(255,255,255,0.25)]">Daily payout</div>
          </div>
          <div className="bg-[rgba(255,255,255,0.03)] px-5 py-[18px] text-center">
            <div className="font-[Georgia,serif] text-[22px] font-bold tracking-[-0.5px] mb-1 text-[#4ade80]">{p ? '$' + totalEarned.toFixed(2) : '—'}</div>
            <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-[rgba(255,255,255,0.25)]">You&apos;ve earned</div>
          </div>
          <div className="bg-[rgba(255,255,255,0.03)] px-5 py-[18px] text-center">
            <div className="font-[Georgia,serif] text-[22px] font-bold tracking-[-0.5px] mb-1 text-[rgba(255,255,255,0.88)]">{daysLeft !== null ? daysLeft + 'd' : '—'}</div>
            <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-[rgba(255,255,255,0.25)]">Remaining</div>
          </div>
        </div>
      </div>

      {/* Eligibility Strip */}
      {wallet && p ? (
        // elig-strip: participated
        <div className="bg-white border border-mw-border rounded-[14px] px-6 py-[18px] flex items-center gap-4 mb-7 [animation:fadeUp_0.5s_0.08s_ease_both] max-[760px]:flex-wrap">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base shrink-0"
            style={{
              background: eligible ? '#f0fdf4' : 'rgba(251,191,36,0.1)',
              border: `1px solid ${eligible ? '#bbf7d0' : 'rgba(180,83,9,0.2)'}`,
            }}
          >
            {eligible ? '✓' : '⚡'}
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-mw-ink mb-[3px]">
              {eligible ? `You're eligible — score ${score} qualifies for full participation` : `Score ${score} is below the minimum of ${minScore}`}
            </div>
            <div className="text-xs text-mw-ink-3">
              Minimum score {minScore} · {eligible ? `Your ${multiplier.toFixed(1)}× multiplier is active` : 'Keep using DeFi to raise your attribution score'}
            </div>
          </div>
          {/* elig-bar-wrap */}
          <div className="flex-1 flex items-center gap-2.5 min-w-0">
            <div className="flex-1 h-1.5 bg-mw-border rounded-[3px] overflow-hidden">
              <div
                className="h-full rounded-[3px]"
                style={{
                  width: Math.min(100, Math.round((score / 1000) * 100)) + '%',
                  background: eligible ? 'linear-gradient(90deg,#0052FF,#7C3AED)' : '#f97316',
                }}
              />
            </div>
            <span className="font-[var(--font-mono),'DM_Mono',monospace] text-xs text-mw-brand whitespace-nowrap font-medium">{score} / 1000</span>
          </div>
          {eligible && (
            <div className="shrink-0 text-xs font-semibold text-mw-green bg-mw-green-muted border border-mw-green-edge rounded-full px-3 py-1 whitespace-nowrap">
              {multiplier.toFixed(1)}× weight
            </div>
          )}
        </div>
      ) : wallet && !p ? (
        // elig-strip: not yet joined
        <div className="bg-white border border-mw-border rounded-[14px] px-6 py-[18px] flex items-center gap-4 mb-7 [animation:fadeUp_0.5s_0.08s_ease_both] max-[760px]:flex-wrap">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base shrink-0"
            style={{ background: 'rgba(0,82,255,0.07)', border: '1px solid rgba(0,82,255,0.15)' }}
          >
            🚀
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-mw-ink mb-[3px]">Join this campaign to start earning</div>
            <div className="text-xs text-mw-ink-3">Minimum score {minScore} required · Joining links your wallet to this campaign</div>
          </div>
          <button
            className="shrink-0 px-[22px] py-2.5 rounded-[10px] bg-mw-brand text-white border-none text-[13px] font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-colors duration-150 whitespace-nowrap hover:bg-[#0040cc] disabled:bg-mw-green disabled:cursor-default"
            onClick={joinCampaign}
            disabled={joining}
          >
            {joining ? 'Joining…' : 'Join campaign'}
          </button>
        </div>
      ) : (
        // elig-strip: not connected
        <div className="bg-white border border-mw-border rounded-[14px] px-6 py-[18px] flex items-center gap-4 mb-7 [animation:fadeUp_0.5s_0.08s_ease_both] max-[760px]:flex-wrap">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base shrink-0"
            style={{ background: '#F7F6FF', border: '1px solid rgba(26,26,46,0.08)' }}
          >
            🔗
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-mw-ink mb-[3px]">Connect wallet to check eligibility</div>
            <div className="text-xs text-mw-ink-3">Minimum score {minScore} required to participate</div>
          </div>
        </div>
      )}

      {/* Main grid */}
      <div className="grid [grid-template-columns:1fr_340px] gap-4 items-start max-[760px]:grid-cols-1">
        {/* Left column */}
        <div>
          {/* Actions card */}
          <div className="bg-white border border-mw-border rounded-2xl p-6 mb-4 last:mb-0 [animation:fadeUp_0.5s_0.12s_ease_both]">
            {/* card-title */}
            <div className="text-[13px] font-bold tracking-[0.5px] text-mw-ink mb-[18px] flex items-center justify-between">
              How to earn points
              <span className="text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-3 font-[var(--font-mono),'DM_Mono',monospace]">
                {actionCount} activities · 1 pool
              </span>
            </div>
            {/* action-list */}
            <div className="flex flex-col gap-2.5">
              {Object.entries(c.actions || {}).map(([key, action]) => {
                const meta = actionMeta(key)
                const pts = action.points
                const multiplied = Math.round(pts * multiplier)
                const ptsLabel = action.per_day ? `+${pts} pts/day` : action.per_referral ? `+${pts} pts/ref` : action.per_referred_trade ? `+${pts} pts/their trade` : `+${pts} pts`
                const multLabel = (p && multiplier > 1) ? `→ +${multiplied} with ${multiplier.toFixed(1)}×` : ''

                let actionBtn = null
                if (key === 'bridge') {
                  const done = p && (p.bridge_points || 0) > 0
                  actionBtn = done ? (
                    <button className="px-4 py-[7px] rounded-lg text-xs font-semibold cursor-default font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] whitespace-nowrap bg-mw-green-muted text-mw-green border border-mw-green-edge hover:bg-mw-green-muted">
                      Done ✓
                    </button>
                  ) : (
                    <button
                      className="px-4 py-[7px] rounded-lg bg-mw-brand text-white border-none text-xs font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-colors duration-150 whitespace-nowrap hover:bg-[#0040cc]"
                      onClick={() => openExternal('bridge')}
                    >
                      Bridge now
                    </button>
                  )
                } else if (key === 'trade') {
                  actionBtn = (
                    <button
                      className="px-4 py-[7px] rounded-lg bg-mw-brand text-white border-none text-xs font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-colors duration-150 whitespace-nowrap hover:bg-[#0040cc]"
                      onClick={() => openExternal('trade')}
                    >
                      Trade now
                    </button>
                  )
                } else if (key.startsWith('referral')) {
                  const refType = key === 'referral_bridge' ? 'bridge' : 'trade'
                  const refLink = wallet
                    ? `mintware.io/r/${wallet.slice(0,10)}/${campaignId}/${refType}`
                    : 'Connect wallet for link'
                  actionBtn = (
                    <button
                      className="px-4 py-[7px] rounded-lg text-xs font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-colors duration-150 whitespace-nowrap bg-transparent text-mw-ink border border-mw-border-strong hover:border-mw-brand hover:text-mw-brand hover:bg-transparent"
                      onClick={e => copyRefLink(refLink, e.currentTarget)}
                    >
                      {wallet ? 'Copy link' : 'Connect'}
                    </button>
                  )
                }

                return (
                  // action
                  <div key={key} className="flex items-center gap-3.5 p-4 bg-mw-surface border border-mw-border rounded-xl transition-all duration-150 hover:border-mw-border-strong hover:-translate-y-px hover:shadow-sm">
                    {/* action-icon */}
                    <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-lg shrink-0" style={{ background: meta.bg }}>
                      {meta.icon}
                    </div>
                    {/* action-body */}
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-mw-ink mb-[3px]">{action.label}</div>
                      <div className="text-xs text-mw-ink-3 leading-[1.5]">{meta.desc}</div>
                    </div>
                    {/* action-right */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="font-[var(--font-mono),'DM_Mono',monospace] text-sm font-medium text-mw-brand whitespace-nowrap">{ptsLabel}</div>
                      {multLabel && <div className="text-[11px] text-mw-green font-semibold whitespace-nowrap">{multLabel}</div>}
                      {actionBtn}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Progress card */}
          {wallet && p ? (
            <div className="bg-white border border-mw-border rounded-2xl p-6 mb-4 last:mb-0 [animation:fadeUp_0.5s_0.18s_ease_both]">
              {/* card-title */}
              <div className="text-[13px] font-bold tracking-[0.5px] text-mw-ink mb-[18px] flex items-center justify-between">
                Your progress
                <span className="text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-3 font-[var(--font-mono),'DM_Mono',monospace]">
                  {actDays} days active
                </span>
              </div>
              {/* progress-grid */}
              <div className="grid grid-cols-2 gap-2.5 mb-[18px] max-[760px]:grid-cols-1">
                <div className="bg-mw-surface border border-mw-border rounded-[10px] px-4 py-3.5">
                  <div className="font-[Georgia,serif] text-xl font-bold tracking-[-0.5px] mb-[3px] text-mw-brand">{totalPoints.toLocaleString()}</div>
                  <div className="text-[11px] text-mw-ink-3">Points earned</div>
                </div>
                <div className="bg-mw-surface border border-mw-border rounded-[10px] px-4 py-3.5">
                  <div className="font-[Georgia,serif] text-xl font-bold tracking-[-0.5px] mb-[3px] text-mw-green">${totalEarned.toFixed(2)}</div>
                  <div className="text-[11px] text-mw-ink-3">Already paid out</div>
                </div>
                <div className="bg-mw-surface border border-mw-border rounded-[10px] px-4 py-3.5">
                  <div className="font-[Georgia,serif] text-xl font-bold text-mw-ink tracking-[-0.5px] mb-[3px]">{actDays}</div>
                  <div className="text-[11px] text-mw-ink-3">Active days</div>
                </div>
                <div className="bg-mw-surface border border-mw-border rounded-[10px] px-4 py-3.5">
                  <div className="font-[Georgia,serif] text-xl font-bold text-mw-ink tracking-[-0.5px] mb-[3px]">
                    {(p.referral_bridge_points || 0) > 0 ? Math.round((p.referral_bridge_points||0)/60) : (p.referral_trade_points||0) > 0 ? '1+' : '0'}
                  </div>
                  <div className="text-[11px] text-mw-ink-3">Referrals active</div>
                </div>
              </div>
              {(() => {
                const bPts = p.bridge_points || 0
                const tPts = p.trading_points || 0
                const rPts = (p.referral_bridge_points || 0) + (p.referral_trade_points || 0)
                const totalForBar = Math.max(bPts + tPts + rPts, 1)
                return (
                  <>
                    {bPts > 0 && (
                      <div className="mb-2.5">
                        <div className="flex justify-between text-[11px] mb-[5px]">
                          <span className="text-mw-ink-3">🌉 Bridge</span>
                          <span className="text-mw-ink font-semibold font-[var(--font-mono),'DM_Mono',monospace]">{bPts} pts</span>
                        </div>
                        <div className="h-[5px] bg-mw-border rounded-[3px] overflow-hidden">
                          <div className="h-full rounded-[3px]" style={{ width: Math.min(100, Math.round(bPts / totalForBar * 100)) + '%', background: '#0052FF' }} />
                        </div>
                      </div>
                    )}
                    {tPts > 0 && (
                      <div className="mb-2.5">
                        <div className="flex justify-between text-[11px] mb-[5px]">
                          <span className="text-mw-ink-3">📈 Trading</span>
                          <span className="text-mw-ink font-semibold font-[var(--font-mono),'DM_Mono',monospace]">{tPts} pts · {actDays} days</span>
                        </div>
                        <div className="h-[5px] bg-mw-border rounded-[3px] overflow-hidden">
                          <div className="h-full rounded-[3px]" style={{ width: Math.min(100, Math.round(tPts / totalForBar * 100)) + '%', background: '#2A9E8A' }} />
                        </div>
                      </div>
                    )}
                    {rPts > 0 && (
                      <div>
                        <div className="flex justify-between text-[11px] mb-[5px]">
                          <span className="text-mw-ink-3">🔗 Referrals</span>
                          <span className="text-mw-ink font-semibold font-[var(--font-mono),'DM_Mono',monospace]">{rPts} pts</span>
                        </div>
                        <div className="h-[5px] bg-mw-border rounded-[3px] overflow-hidden">
                          <div className="h-full rounded-[3px]" style={{ width: Math.min(100, Math.round(rPts / totalForBar * 100)) + '%', background: '#7B6FCC' }} />
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
              <div className="mt-3.5 p-3 bg-mw-surface rounded-[10px] text-xs text-mw-ink-3 leading-[1.5]" style={{ padding: '12px 14px', borderRadius: 10 }}>
                {fmtUSD(c.daily_payout_usd)} {c.token_symbol} distributes every 24 hours to all active participants, weighted by that day&apos;s score. Stay active daily to maximize earnings.
              </div>
            </div>
          ) : wallet ? (
            <div className="bg-white border border-mw-border rounded-2xl p-6 mb-4 last:mb-0 [animation:fadeUp_0.5s_0.18s_ease_both]">
              <div className="text-[13px] font-bold tracking-[0.5px] text-mw-ink mb-[18px] flex items-center justify-between">
                Your progress
              </div>
              {/* connect-prompt-card */}
              <div className="text-center py-8 px-6 text-mw-ink-3">
                <div className="text-[28px] mb-2.5">🚀</div>
                <div className="text-[13px] mb-4 leading-[1.5]">Join this campaign to start tracking your points and earnings.</div>
                <button
                  className="px-6 py-2.5 rounded-[10px] bg-mw-brand text-white border-none text-[13px] font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-colors duration-150 hover:bg-[#0040cc]"
                  onClick={joinCampaign}
                >
                  Join campaign
                </button>
              </div>
            </div>
          ) : null}

          {/* Leaderboard card */}
          <div className="bg-white border border-mw-border rounded-2xl p-6 mb-4 last:mb-0 [animation:fadeUp_0.5s_0.24s_ease_both]">
            {/* card-title */}
            <div className="text-[13px] font-bold tracking-[0.5px] text-mw-ink mb-[18px] flex items-center justify-between">
              Campaign leaderboard
              <span className="text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-3 font-[var(--font-mono),'DM_Mono',monospace]">
                {leaderboard.length} participant{leaderboard.length !== 1 ? 's' : ''}
              </span>
            </div>
            {/* lb-list */}
            <div className="flex flex-col gap-1.5">
              {leaderboard.length === 0 ? (
                <div className="text-center py-5 text-mw-ink-3 text-[13px]">
                  {campaign ? 'No participants yet — be the first!' : 'Loading leaderboard…'}
                </div>
              ) : (
                <>
                  {leaderboard.slice(0, 5).map((row, i) => {
                    const isYou = wallet && row.wallet === wallet
                    const acol = avatarColors[i] || { bg: '#F7F6FF', fg: '#8A8C9E' }
                    const rankColorClass =
                      i === 0 ? 'text-[#B45309] font-bold' :
                      i === 1 ? 'text-mw-ink-2 font-bold' :
                      i === 2 ? 'text-[#92400E] font-bold' :
                      ''
                    return (
                      <div
                        key={row.wallet}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-colors duration-150 hover:bg-mw-surface${isYou ? ' bg-mw-brand-dim border border-[rgba(0,82,255,0.15)]' : ''}`}
                      >
                        {/* lb-rank */}
                        <span className={`font-[var(--font-mono),'DM_Mono',monospace] text-xs text-mw-ink-3 w-7 text-right shrink-0 ${rankColorClass}`}>
                          #{i + 1}
                        </span>
                        {/* lb-avatar */}
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                          style={{ background: isYou ? 'rgba(0,82,255,0.07)' : acol.bg, color: isYou ? '#0052FF' : acol.fg }}
                        >
                          {row.wallet.charAt(2).toUpperCase()}
                        </div>
                        {/* lb-addr */}
                        <span className="font-[var(--font-mono),'DM_Mono',monospace] text-xs text-mw-ink-2 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                          {shortAddr(row.wallet)}
                        </span>
                        {isYou && (
                          <span className="text-[10px] font-bold text-mw-brand bg-mw-brand-dim border border-[rgba(0,82,255,0.2)] rounded-[10px] px-[7px] py-px shrink-0">
                            you
                          </span>
                        )}
                        {/* lb-pts */}
                        <span className="font-[var(--font-mono),'DM_Mono',monospace] text-xs text-mw-ink font-medium whitespace-nowrap">
                          {(row.total_points || 0).toLocaleString()} pts
                        </span>
                        {/* lb-earned */}
                        <span className="text-[11px] text-mw-green font-semibold whitespace-nowrap ml-1">
                          ${parseFloat(String(row.total_earned_usd || 0)).toFixed(0)}
                        </span>
                      </div>
                    )
                  })}
                  {wallet && userLbIdx >= 5 && (() => {
                    const row = leaderboard[userLbIdx]
                    return (
                      <>
                        <div className="h-px bg-mw-border my-1.5" />
                        <div className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] bg-mw-brand-dim border border-[rgba(0,82,255,0.15)]">
                          <span className="font-[var(--font-mono),'DM_Mono',monospace] text-xs text-mw-ink-3 w-7 text-right shrink-0">
                            #{userLbIdx + 1}
                          </span>
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                            style={{ background: 'rgba(0,82,255,0.07)', color: '#0052FF' }}
                          >
                            {wallet.charAt(2).toUpperCase()}
                          </div>
                          <span className="font-[var(--font-mono),'DM_Mono',monospace] text-xs text-mw-ink-2 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                            {shortAddr(wallet)}
                          </span>
                          <span className="text-[10px] font-bold text-mw-brand bg-mw-brand-dim border border-[rgba(0,82,255,0.2)] rounded-[10px] px-[7px] py-px shrink-0">
                            you
                          </span>
                          <span className="font-[var(--font-mono),'DM_Mono',monospace] text-xs text-mw-ink font-medium whitespace-nowrap">
                            {(row.total_points || 0).toLocaleString()} pts
                          </span>
                          <span className="text-[11px] text-mw-green font-semibold whitespace-nowrap ml-1">
                            ${parseFloat(String(row.total_earned_usd || 0)).toFixed(0)}
                          </span>
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
        <div>
          <Countdown dailyPayout={c.daily_payout_usd} tokenSymbol={c.token_symbol} daysLeft={daysLeft} />

          {/* Reward pool side-card */}
          <div className="bg-white border border-mw-border rounded-2xl p-[22px] mb-4 last:mb-0 [animation:fadeUp_0.5s_0.18s_ease_both]">
            <div className="text-[13px] font-bold text-mw-ink mb-3.5">Reward pool</div>
            <div className="flex justify-between items-center py-2 border-b border-mw-border last:border-b-0">
              <span className="text-xs text-mw-ink-3">Total pool</span>
              <span className="text-xs font-semibold text-mw-ink font-[var(--font-mono),'DM_Mono',monospace]">{fmtUSD(c.pool_usd)} {c.token_symbol}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-mw-border last:border-b-0">
              <span className="text-xs text-mw-ink-3">Daily payout</span>
              <span className="text-xs font-semibold text-mw-brand font-[var(--font-mono),'DM_Mono',monospace]">{fmtUSD(c.daily_payout_usd)} {c.token_symbol}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-mw-border last:border-b-0">
              <span className="text-xs text-mw-ink-3">Payout schedule</span>
              <span className="text-xs font-semibold text-mw-ink font-[var(--font-mono),'DM_Mono',monospace]">Every 24 hrs</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-mw-border last:border-b-0">
              <span className="text-xs text-mw-ink-3">Minimum score</span>
              <span className="text-xs font-semibold text-mw-ink font-[var(--font-mono),'DM_Mono',monospace]">{minScore}+</span>
            </div>
            {p && (
              <>
                <div className="flex justify-between items-center py-2 border-b border-mw-border last:border-b-0">
                  <span className="text-xs text-mw-ink-3">Your weight</span>
                  <span className="text-xs font-semibold text-mw-ink font-[var(--font-mono),'DM_Mono',monospace]">{multiplier.toFixed(1)}×</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-mw-border last:border-b-0">
                  <span className="text-xs text-mw-ink-3">You&apos;ve earned</span>
                  <span className="text-xs font-semibold text-mw-green font-[var(--font-mono),'DM_Mono',monospace]">${totalEarned.toFixed(2)}</span>
                </div>
              </>
            )}
            {daysLeft !== null && (
              <div className="flex justify-between items-center py-2 border-b border-mw-border last:border-b-0">
                <span className="text-xs text-mw-ink-3">Days remaining</span>
                <span className="text-xs font-semibold text-mw-ink font-[var(--font-mono),'DM_Mono',monospace]">{daysLeft}d</span>
              </div>
            )}
          </div>

          {/* Referral links side-card */}
          <div className="bg-white border border-mw-border rounded-2xl p-[22px] mb-4 last:mb-0 [animation:fadeUp_0.5s_0.22s_ease_both]">
            <div className="text-[13px] font-bold text-mw-ink mb-3.5">Your referral links</div>
            <div className="text-xs text-mw-ink-3 leading-[1.55] mb-4">
              Share the right link for what you want them to do. You earn points when they act.
            </div>
            <div className="text-[11px] font-bold text-mw-ink-3 tracking-[0.5px] uppercase mb-1.5">Bridge link</div>
            <div className="flex gap-1.5 mb-3">
              <input
                className="flex-1 px-3 py-[9px] bg-mw-surface border border-mw-border-strong rounded-lg font-[var(--font-mono),'DM_Mono',monospace] text-xs text-mw-ink-2 outline-none"
                type="text"
                value={bridgeLink}
                readOnly
              />
              <button
                className="px-3.5 py-[9px] rounded-lg bg-transparent border border-mw-border-strong text-mw-ink text-xs font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] whitespace-nowrap transition-all duration-150 hover:border-mw-brand hover:text-mw-brand"
                onClick={e => copyRefLink(bridgeLink, e.currentTarget)}
              >
                Copy
              </button>
            </div>
            <div className="text-[11px] font-bold text-mw-ink-3 tracking-[0.5px] uppercase mb-1.5">Trade link</div>
            <div className="flex gap-1.5 mb-3">
              <input
                className="flex-1 px-3 py-[9px] bg-mw-surface border border-mw-border-strong rounded-lg font-[var(--font-mono),'DM_Mono',monospace] text-xs text-mw-ink-2 outline-none"
                type="text"
                value={tradeLink}
                readOnly
              />
              <button
                className="px-3.5 py-[9px] rounded-lg bg-transparent border border-mw-border-strong text-mw-ink text-xs font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] whitespace-nowrap transition-all duration-150 hover:border-mw-brand hover:text-mw-brand"
                onClick={e => copyRefLink(tradeLink, e.currentTarget)}
              >
                Copy
              </button>
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
      <MwNav />
      <MwAuthGuard>
        <CampaignContent />
      </MwAuthGuard>
    </>
  )
}

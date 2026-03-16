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
      <div
        key={entry.wallet + rank}
        className={[
          'grid items-center py-[11px] border-b border-[rgba(26,26,46,0.04)] cursor-pointer transition-all duration-100 rounded-lg',
          '[grid-template-columns:44px_1fr_90px_100px_80px] max-sm:[grid-template-columns:36px_1fr_70px_80px]',
          isMe
            ? 'bg-mw-brand-dim -mx-2 px-2 border-l-2 border-l-mw-brand rounded-none'
            : 'hover:bg-mw-surface hover:-mx-2 hover:px-2',
        ].join(' ')}
      >
        <div className={`text-xs font-bold font-[var(--font-mono),'DM_Mono',monospace] text-center ${rank <= 3 ? 'text-mw-ink text-sm' : 'text-mw-ink-3'}`}>{rank}</div>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[13px] font-bold font-[var(--font-mono),'DM_Mono',monospace] text-mw-ink-2" style={{background:avatarBg(entry.wallet)}}>
            {entry.wallet.charAt(2).toUpperCase()}
          </div>
          <div className="text-xs font-semibold text-mw-ink font-[var(--font-mono),'DM_Mono',monospace] overflow-hidden text-ellipsis whitespace-nowrap">
            {shortAddr(entry.wallet)}
            {isMe && <span className="text-[9px] font-bold text-mw-brand bg-mw-brand-dim border border-[rgba(0,82,255,0.2)] rounded-lg px-1.5 py-px ml-1 align-middle">you</span>}
          </div>
        </div>
        <div className="text-[13px] font-bold text-mw-brand font-[var(--font-mono),'DM_Mono',monospace] text-right">{entry.attribution_score || 0}</div>
        <div className="text-[13px] font-semibold text-mw-green text-right">{fmtUSD(entry.total_earned_usd || 0)}</div>
        <div className="text-xs text-mw-ink-3 text-right font-[var(--font-mono),'DM_Mono',monospace] max-sm:hidden">{(entry.total_points || 0).toLocaleString()}</div>
      </div>
    )
  }

  return (
    <div className="max-w-[960px] mx-auto px-12 pt-10 pb-20 max-sm:px-5 max-sm:pt-6 max-sm:pb-[60px]">
      {/* Campaign selector */}
      <div className="mb-6 animate-fade-up">
        <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-mw-ink-3 mb-2 block">Campaign</span>
        <div className="flex gap-2 flex-wrap">
          {campaigns.length === 0
            ? <div className="px-[18px] py-1.5 rounded-full border border-mw-border-strong bg-white text-mw-ink-3 text-[13px] font-medium opacity-50 shadow-[0_1px_3px_rgba(26,26,46,0.04)]">Loading campaigns…</div>
            : campaigns.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveCampaignId(c.id)}
                className={[
                  'px-[18px] py-1.5 rounded-full border text-[13px] font-medium cursor-pointer transition-all duration-150 font-[var(--font-jakarta),"Plus_Jakarta_Sans",sans-serif] shadow-[0_1px_3px_rgba(26,26,46,0.04)]',
                  c.id === activeCampaignId
                    ? 'bg-mw-ink text-white border-mw-ink shadow-sm'
                    : 'bg-white text-mw-ink-3 border-mw-border-strong hover:border-mw-brand hover:text-mw-brand hover:bg-mw-brand-dim',
                ].join(' ')}
              >
                {c.name}
              </button>
            ))}
        </div>
      </div>

      {/* Your rank banner */}
      {me && (
        <div className="mw-grid-overlay mw-glow-tr bg-mw-ink rounded-[20px] px-7 py-[22px] flex items-center gap-6 mb-4 text-white [animation:fadeUp_0.45s_0.05s_ease_both] max-sm:flex-wrap max-sm:gap-4 max-sm:p-5">
          <div className="relative z-[1]">
            <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-[rgba(255,255,255,0.35)] mb-1">Your rank</div>
            <div className="font-[Georgia,serif] text-[38px] font-bold tracking-[-1.5px] leading-none shrink-0 text-mw-brand">#{myIdx + 1}</div>
          </div>
          <div className="w-px bg-[rgba(255,255,255,0.08)] self-stretch shrink-0 relative z-[1]" />
          <div className="flex-1 min-w-0 relative z-[1]">
            <div className="text-[10px] font-bold tracking-[1.2px] uppercase text-[rgba(255,255,255,0.35)] mb-1">Points</div>
            <div className="text-xl font-bold font-[var(--font-mono),'DM_Mono',monospace]">
              {(me.total_points || 0).toLocaleString()} pts
            </div>
          </div>
          <div className="flex-1 min-w-0 relative z-[1]">
            <div className="h-1 bg-[rgba(255,255,255,0.1)] rounded-sm overflow-hidden mb-1.5">
              <div
                className="h-full bg-mw-brand rounded-sm transition-[width] duration-[800ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
                style={{width: Math.max(2, Math.round(((total - (myIdx+1)) / total) * 100)) + '%'}}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[rgba(255,255,255,0.28)]">
              <span>#1</span>
              <span>#{myIdx + 1} · top {100 - Math.round(((total - (myIdx+1)) / total) * 100)}%</span>
            </div>
          </div>
          <div className="text-right shrink-0 relative z-[1]">
            <div className="text-[10px] font-bold tracking-[1px] uppercase text-[rgba(255,255,255,0.35)] mb-[3px]">Earned</div>
            <div className="font-[var(--font-mono),'DM_Mono',monospace] text-[22px] font-bold text-[#4ade80]">{fmtUSD(me.total_earned_usd || 0)}</div>
          </div>
        </div>
      )}

      {/* Main leaderboard card */}
      <div className="bg-white border border-mw-border rounded-[20px] overflow-hidden mb-4 [animation:fadeUp_0.5s_0.1s_ease_both] shadow-[0_2px_12px_rgba(26,26,46,0.05)]">
        <div className="px-7 pt-[22px]">
          <div className="text-[17px] font-bold text-mw-ink mb-[3px] tracking-[-0.2px]">Campaign leaderboard</div>
          <div className="text-xs text-mw-ink-3 font-[var(--font-mono),'DM_Mono',monospace] mb-4">{lbSubText}</div>
          {/* Tabs */}
          <div className="flex gap-0 border-b border-mw-border -mx-7 px-7 max-sm:-mx-5 max-sm:px-5">
            {(['points','score','referrals'] as const).map(tab => (
              <div
                key={tab}
                onClick={() => setSortBy(tab)}
                className={[
                  'px-[18px] py-2.5 text-[13px] font-medium cursor-pointer border-b-2 -mb-px whitespace-nowrap transition-all duration-150',
                  sortBy === tab
                    ? 'text-mw-brand border-b-mw-brand font-semibold'
                    : 'text-mw-ink-3 border-b-transparent hover:text-mw-ink',
                ].join(' ')}
              >
                {tab === 'points' ? 'Top earners' : tab === 'score' ? 'Top score' : 'Top referrers'}
              </div>
            ))}
          </div>
        </div>

        <div className="px-7 pb-7 max-sm:px-5 max-sm:pb-5">
          {/* Podium */}
          {sorted.length >= 3 && !loading && (
            <div className="grid [grid-template-columns:1fr_1.15fr_1fr] gap-2.5 py-[22px] items-end max-sm:grid-cols-1">
              {[sorted[1], sorted[0], sorted[2]].map((entry, i) => {
                const medals = ['🥈','🥇','🥉']
                const podStyles = [
                  'bg-mw-surface border-mw-border-strong order-1',
                  'bg-gradient-to-b from-[#fffef0] to-[#fffbf0] border-[#fde68a] order-2 max-sm:order-none',
                  'bg-[#fff9f7] border-[#fed7aa] order-3',
                ]
                const isMe = wallet && entry.wallet === wallet
                const val = sortBy === 'score' ? (entry.attribution_score || 0) : (entry.total_points || 0)
                const valLabel = sortBy === 'score' ? 'score' : 'pts'
                return (
                  <div
                    key={entry.wallet + i}
                    className={`${podStyles[i]} rounded-[14px] p-[18px] px-3.5 text-center cursor-pointer transition-all duration-150 border hover:-translate-y-0.5 hover:shadow-md max-sm:order-none ${isMe ? 'outline outline-2 outline-mw-brand outline-offset-[3px]' : ''}`}
                  >
                    <div className="text-2xl mb-2">{medals[i]}</div>
                    <div className="w-11 h-11 rounded-xl mx-auto mb-2 flex items-center justify-center text-lg font-bold font-[var(--font-mono),'DM_Mono',monospace] text-mw-ink-2" style={{background:avatarBg(entry.wallet)}}>
                      {entry.wallet.charAt(2).toUpperCase()}
                    </div>
                    <div className="text-[11px] font-bold text-mw-ink mb-[3px] font-[var(--font-mono),'DM_Mono',monospace]">
                      {shortAddr(entry.wallet)}{isMe && <span className="text-[9px] font-bold text-mw-brand bg-mw-brand-dim border border-[rgba(0,82,255,0.2)] rounded-lg px-1.5 py-px ml-1 align-middle">you</span>}
                    </div>
                    <div className="text-2xl font-bold font-[Georgia,serif] text-mw-ink tracking-[-0.5px]">{val.toLocaleString()}</div>
                    <div className="text-[10px] text-mw-ink-3 mt-px font-semibold tracking-[0.5px] uppercase">{valLabel}</div>
                    <div className="text-[11px] text-mw-green font-semibold mt-2 bg-mw-green-muted border border-mw-green-edge px-2.5 py-[3px] rounded-full inline-block">{fmtUSD(entry.total_earned_usd || 0)} earned</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Table header */}
          <div className="grid [grid-template-columns:44px_1fr_90px_100px_80px] max-sm:[grid-template-columns:36px_1fr_70px_80px] py-3 pb-2 border-b border-mw-border">
            {['#','Wallet','Score','Earned','Points'].map((h, i) => (
              <div key={h} className={`text-[10px] font-bold text-mw-ink-3 tracking-[0.5px] uppercase ${i === 0 ? 'text-center' : i === 1 ? 'text-left' : 'text-right'} ${i === 4 ? 'max-sm:hidden' : ''}`}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          {loading ? (
            <div className="py-5">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="mw-shimmer h-11 rounded-[10px] bg-mw-border mb-2" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12 text-mw-ink-3 text-sm">No participants yet — be the first!</div>
          ) : (
            <>
              {top10.map((entry, i) => buildRow(entry, i + 1, !!(wallet && entry.wallet === wallet)))}
              {showUser && (
                <>
                  <div className="py-2.5 text-center text-[11px] text-mw-ink-3 tracking-[3px] border-b border-mw-border">· · ·</div>
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

'use client'

import { useAccount } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
import { API, fmtUSD, daysUntil } from '@/lib/web2/api'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { Users, Coins, TrendingUp } from 'lucide-react'

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

  const refLink = wallet ? `mintware.app/r/${wallet.slice(0, 10)}` : ''

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
    const RANK_COLORS: Record<number, string> = { 1: '#f59e0b', 2: 'var(--color-mw-ink-5)', 3: '#d97706' }
    const rankColor = RANK_COLORS[rank] ?? 'var(--color-mw-ink-3)'
    return (
      <tr
        key={entry.wallet + rank}
        className={`cursor-pointer ${isMe ? 'lb-row-me' : 'lb-row'}`}
      >
        <td
          className="lb-td lb-rank"
          style={{ color: rank <= 3 ? rankColor : 'var(--color-mw-ink-5)', fontWeight: rank <= 3 ? 700 : 500 }}
        >
          {rank}
        </td>
        <td className="lb-td">
          <div className="flex items-center gap-[10px]">
            <div className="w-[30px] h-[30px] rounded-full bg-[var(--color-mw-brand-mid)] text-mw-brand flex items-center justify-center text-[11px] font-bold shrink-0 font-mono">
              {entry.wallet.charAt(2).toUpperCase()}
            </div>
            <WalletDisplay
              address={entry.wallet}
              mono
              style={{ fontSize: 13, fontWeight: 500 }}
            />
            {isMe && <span className="text-[11px] text-mw-live ml-[6px]">(you)</span>}
          </div>
        </td>
        <td className="lb-td lb-right font-semibold text-mw-brand font-mono">
          {entry.attribution_score || 0}
        </td>
        <td className="lb-td lb-right font-semibold text-mw-live font-mono">
          {fmtUSD(entry.total_earned_usd || 0)}
        </td>
        <td className="lb-td lb-right lb-pts-col font-medium text-mw-ink font-mono">
          {(entry.total_points || 0).toLocaleString()}
        </td>
      </tr>
    )
  }

  return (
    <>

      <div className="page-leaderboard bg-mw-bg min-h-screen">
        <div className="flex items-start max-[820px]:flex-col">
          {/* ── Main column ── */}
          <div className="flex-1 p-7 pb-10 min-w-0 max-[820px]:p-4 max-[820px]:pb-5">
            {/* ── User-first hero ── */}
            <div className="mw-hero-gradient rounded-lg mb-6 overflow-hidden relative">
              <div className="flex items-stretch px-8 py-7 relative">

                {/* Left: Rank number */}
                <div className="shrink-0 w-[120px] flex flex-col justify-center pr-8">
                  <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-mw-ink-3 mb-[10px] font-sans">Your rank</div>
                  {loading ? (
                    <div className="w-[80px] h-14 rounded-[8px] bg-[rgba(15,23,42,0.07)]" />
                  ) : me ? (
                    <>
                      <div className={`text-[56px] font-bold leading-none font-mono tracking-[-3px]${myIdx === 0 ? ' text-[#fbbf24]' : ' text-mw-ink'}`}>
                        #{myIdx + 1}
                      </div>
                      <div className="text-[12px] text-mw-ink-5 mt-[6px] font-sans">of {total}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[56px] font-bold text-[rgba(15,23,42,0.15)] leading-none font-mono tracking-[-3px]">—</div>
                      <div className="text-[12px] text-mw-ink-3 mt-[6px] font-sans">{total > 0 ? `${total} ranked` : ''}</div>
                    </>
                  )}
                </div>

                {/* Vertical divider */}
                <div className="w-[0.5px] bg-[rgba(15,23,42,0.08)] shrink-0 self-stretch mr-8" />

                {/* Right: Context */}
                <div className="flex-1 flex flex-col justify-center">
                  <div className="flex items-center gap-[6px] mb-[10px]">
                    <div className="w-[5px] h-[5px] rounded-full bg-[#b45309] shrink-0" />
                    <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-[#b45309] font-sans">
                      {activeCampaign?.name ?? (campaigns.length > 0 ? campaigns[0].name : 'Campaign')} · live rankings
                    </span>
                  </div>

                  {loading ? (
                    <>
                      <div className="w-[55%] h-[22px] rounded-[6px] bg-[rgba(15,23,42,0.07)] mb-[10px]" />
                      <div className="w-[75%] h-[14px] rounded-[6px] bg-[rgba(15,23,42,0.04)]" />
                    </>
                  ) : me ? (
                    <>
                      <div className="text-[20px] font-bold text-mw-ink tracking-[-0.5px] mb-[6px] font-sans leading-tight">
                        {myIdx === 0 ? "You're leading the campaign." : `${(me.total_points || 0).toLocaleString()} pts earned`}
                      </div>
                      {myIdx === 0 ? (
                        <div className="text-[13px] text-[#4ade80] font-semibold font-sans">🏆 First place — hold your ground.</div>
                      ) : (() => {
                        const above = sorted[myIdx - 1]
                        const gap = (above?.total_points || 0) - (me.total_points || 0)
                        return gap > 0 ? (
                          <div className="text-[13px] text-mw-ink-3 leading-relaxed font-sans">
                            <span className="text-[#b45309] font-semibold">{gap.toLocaleString()} pts</span> behind rank #{myIdx}
                            {daysLeft !== null && <span> · {daysLeft} day{daysLeft !== 1 ? 's' : ''} left</span>}
                          </div>
                        ) : null
                      })()}
                    </>
                  ) : (
                    <>
                      <div className="text-[20px] font-bold text-mw-ink tracking-[-0.5px] mb-[6px] font-sans">
                        {wallet ? "You're not on the board yet." : 'Connect to see your rank.'}
                      </div>
                      <div className="text-[13px] text-mw-ink-3 leading-relaxed font-sans">
                        {wallet
                          ? 'One swap enters you into the rankings. Your Attribution score gives you a head start.'
                          : `${total > 0 ? `${total} wallets competing.` : 'Rankings are live.'} Connect yours to join.`
                        }
                      </div>
                    </>
                  )}
                </div>

              </div>
            </div>

            {/* Campaign selector */}
            <div className="flex gap-2 mb-6 items-center flex-wrap">
              <span className="text-[12px] text-mw-ink-3 font-sans">Campaign</span>
              {campaigns.length === 0
                ? <button className="lb-cs-btn inactive py-[7px] px-4 rounded-xl text-[13px] font-medium bg-white text-mw-ink-3 border border-[rgba(0,0,0,0.12)] shadow-card font-sans cursor-not-allowed" disabled>Loading…</button>
                : campaigns.map(c => (
                  <button
                    key={c.id}
                    className={`py-[7px] px-4 rounded-xl text-[13px] cursor-pointer font-sans transition-colors duration-150 ${
                      c.id === activeCampaignId
                        ? 'lb-cs-btn font-semibold bg-mw-ink text-white border-none'
                        : 'lb-cs-btn inactive font-medium mw-accent-pill'
                    }`}
                    onClick={() => setActiveCampaignId(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-6 max-[820px]:grid-cols-2">
              <div className="mw-accent-card bg-white rounded-md p-5 shadow-card">
                <div className="flex items-center gap-[10px] mb-4">
                  <div className="w-8 h-8 rounded-[8px] bg-[rgba(79,126,247,0.1)] flex items-center justify-center shrink-0">
                    <Users size={15} className="text-mw-brand" />
                  </div>
                  <div className="text-[11px] text-mw-ink-3 uppercase tracking-[0.6px] font-sans font-semibold">Participants</div>
                </div>
                <div className="text-[30px] font-bold tracking-[-0.8px] text-mw-ink font-mono leading-none">{loading ? '—' : total}</div>
                <div className="text-[12px] text-mw-ink-5 mt-[6px] font-sans">{total === 0 ? 'Be the first to join' : 'Ranked wallets'}</div>
              </div>
              <div className="mw-accent-card bg-white rounded-md p-5 shadow-card">
                <div className="flex items-center gap-[10px] mb-4">
                  <div className="w-8 h-8 rounded-[8px] bg-[rgba(22,163,74,0.1)] flex items-center justify-center shrink-0">
                    <Coins size={15} className="text-mw-green" />
                  </div>
                  <div className="text-[11px] text-mw-ink-3 uppercase tracking-[0.6px] font-sans font-semibold">Pool remaining</div>
                </div>
                <div className="text-[30px] font-bold tracking-[-0.8px] text-mw-green font-mono leading-none">{activeCampaign?.pool_usd != null ? fmtUSD(activeCampaign.pool_usd) : '—'}</div>
                <div className="text-[12px] text-mw-ink-5 mt-[6px] font-sans">{daysLeft !== null ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left` : 'Campaign pool'}</div>
              </div>
              <div className="mw-accent-card bg-white rounded-md p-5 shadow-card">
                <div className="flex items-center gap-[10px] mb-4">
                  <div className="w-8 h-8 rounded-[8px] bg-[rgba(22,163,74,0.1)] flex items-center justify-center shrink-0">
                    <TrendingUp size={15} className="text-mw-green" />
                  </div>
                  <div className="text-[11px] text-mw-ink-3 uppercase tracking-[0.6px] font-sans font-semibold">Daily payout</div>
                </div>
                <div className="text-[30px] font-bold tracking-[-0.8px] text-mw-green font-mono leading-none">{activeCampaign?.daily_payout_usd != null ? fmtUSD(activeCampaign.daily_payout_usd) : '—'}</div>
                <div className="text-[12px] text-mw-ink-5 mt-[6px] font-sans">distributed to earners</div>
              </div>
            </div>

            {/* Table card */}
            <div className="mw-accent-card rounded-md overflow-hidden shadow-card">
              <div className="px-5 py-4 border-b border-[0.5px] border-mw-border flex items-center justify-between">
                <div className="text-[15px] font-semibold text-mw-ink font-sans">Campaign leaderboard</div>
                <div className="text-[12px] text-mw-ink-3 font-sans">Updates every 5 min</div>
              </div>

              {/* Sort tabs */}
              <div className="flex border-b border-[0.5px] border-mw-border">
                {(['points', 'score', 'referrals'] as const).map(tab => (
                  <button
                    key={tab}
                    className={`py-[10px] px-4 text-[13px] cursor-pointer border-none bg-transparent font-sans transition-colors duration-150 border-b-2 -mb-[1px] ${
                      sortBy === tab
                        ? 'text-mw-brand border-mw-brand font-semibold'
                        : 'text-mw-ink-3 border-transparent hover:text-mw-ink'
                    }`}
                    onClick={() => setSortBy(tab)}
                  >
                    {tab === 'points' ? 'Top earners' : tab === 'score' ? 'Top score' : 'Top referrers'}
                  </button>
                ))}
              </div>

              <table className="lb-table w-full border-collapse">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-bold text-mw-ink-3 uppercase tracking-[0.8px] text-left border-b border-[0.5px] border-mw-border bg-mw-bg font-sans w-12">#</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-mw-ink-3 uppercase tracking-[0.8px] text-left border-b border-[0.5px] border-mw-border bg-mw-bg font-sans">Wallet</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-mw-ink-3 uppercase tracking-[0.8px] text-right border-b border-[0.5px] border-mw-border bg-mw-bg font-sans">Score</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-mw-ink-3 uppercase tracking-[0.8px] text-right border-b border-[0.5px] border-mw-border bg-mw-bg font-sans">Earned</th>
                    <th className="lb-pts-col px-4 py-3 text-[10px] font-bold text-mw-ink-3 uppercase tracking-[0.8px] text-right border-b border-[0.5px] border-mw-border bg-mw-bg font-sans">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-4">
                        {[1, 2, 3, 4, 5].map(i => (
                          <div key={i} className="h-11 rounded-sm bg-mw-bg mb-2" />
                        ))}
                      </td>
                    </tr>
                  ) : sorted.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-mw-ink-3 text-[14px] font-sans">
                        No participants yet — be the first!
                        <span className="text-[12px] block mt-[6px] text-mw-ink-5">
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
          <div className="w-[300px] shrink-0 p-7 py-7 px-5 border-l border-[0.5px] border-mw-border max-[820px]:w-full max-[820px]:border-l-0 max-[820px]:border-t max-[820px]:p-5">

            {/* How to earn */}
            {activeCampaign?.actions && Object.keys(activeCampaign.actions).length > 0 && (
              <div className="mw-accent-section mt-5 rounded-[10px] p-3">
                <div className="text-[11px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 mb-3 font-sans">How to earn points</div>
                {Object.entries(activeCampaign.actions).map(([key, action]) => {
                  const suffix = action.per_day ? '/day' : action.per_referral ? '/ref' : action.per_referred_trade ? '/trade' : ''
                  const dotColors: Record<string, string> = {
                    trade: 'var(--color-mw-teal)',
                    bridge: 'var(--color-mw-brand)',
                    hold: '#C27A00',
                  }
                  const dotColor = key.startsWith('referral') ? '#7B6FCC' : (dotColors[key] ?? 'var(--color-mw-brand)')
                  return (
                    <div key={key} className="flex items-center gap-[10px] py-[10px] border-b border-[0.5px] border-[rgba(0,0,0,0.06)] last:border-b-0">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
                      <div className="flex-1 text-[13px] text-mw-ink-3 font-sans">{action.label}</div>
                      <div className="text-[13px] font-bold text-mw-brand font-mono">+{action.points}{suffix}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Invite */}
            {wallet && (
              <div className="mt-5">
                <div className="mw-accent-card rounded-[10px] p-[14px] shadow-card">
                  <div className="text-[11px] font-bold tracking-[0.8px] uppercase text-mw-ink-3 mb-2 font-sans">Invite friends</div>
                  <div className="text-[13px] text-mw-ink-3 mb-3 font-sans">Share your link to earn +60 pts per completed referral</div>
                  <div className="bg-mw-bg rounded-sm p-[9px_12px] text-[11px] font-mono text-mw-ink-3 flex items-center justify-between">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">{refLink}</span>
                    <button
                      className="text-[11px] text-mw-brand cursor-pointer font-sans bg-transparent border-0 font-semibold"
                      onClick={copyLink}
                    >
                      {linkCopied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
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

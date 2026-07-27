'use client'

import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState, useCallback } from 'react'
import { API, fmtUSD, daysUntil } from '@/lib/web2/api'
import { generateRefCode } from '@/lib/rewards/referral/utils'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { Users, Coins, TrendingUp } from 'lucide-react'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

// ─── ATX Settlemint tokens ──────────────────────────────────────────────────────
const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const TH = 'px-4 py-3 text-[10px] font-bold text-atx-ink/55 uppercase tracking-[0.1em] border-b border-atx-ink bg-atx-bone font-atx-mono'

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
  const { evmAddress } = useMintwareIdentity()
  const wallet = evmAddress?.toLowerCase() ?? ''

  const [campaigns, setCampaigns]             = useState<Campaign[]>([])
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null)
  const [allEntries, setAllEntries]           = useState<LeaderboardEntry[]>([])
  const [sortBy, setSortBy]                   = useState<'points' | 'score' | 'referrals'>('points')
  const [loading, setLoading]                 = useState(false)
  const [lbSubText, setLbSubText]             = useState('Loading…')
  const [linkCopied, setLinkCopied]           = useState(false)

  const refCode = wallet ? generateRefCode(wallet) : ''
  const refLink = refCode ? `${typeof window !== 'undefined' ? window.location.origin : 'https://mintware.finance'}/ref/${refCode}` : ''

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
    // Duotone rank accents: leader → coral, others → ink.
    const RANK_COLORS: Record<number, string> = { 1: 'var(--color-atx-coral)', 2: 'var(--color-atx-grey)', 3: 'var(--color-atx-clay)' }
    const rankColor = RANK_COLORS[rank] ?? 'var(--color-atx-ink)'
    return (
      <tr
        key={entry.wallet + rank}
        className={`cursor-pointer ${isMe ? 'lb-row-me' : 'lb-row'}`}
      >
        <td
          className="lb-td font-atx-mono"
          style={{ color: rank <= 3 ? rankColor : 'var(--color-atx-ink)', opacity: rank <= 3 ? 1 : 0.5, fontWeight: rank <= 3 ? 700 : 500 }}
        >
          {String(rank).padStart(2, '0')}
        </td>
        <td className="lb-td">
          <div className="flex items-center gap-[10px]">
            <div className="w-[30px] h-[30px] border border-atx-ink bg-atx-panel text-atx-blue flex items-center justify-center text-[11px] font-bold shrink-0 font-atx-mono">
              {entry.wallet.charAt(2).toUpperCase()}
            </div>
            <WalletDisplay
              address={entry.wallet}
              mono
              style={{ fontSize: 13, fontWeight: 500 }}
            />
            {isMe && <span className="text-[11px] text-atx-mesquite ml-[6px] font-atx-mono">(you)</span>}
          </div>
        </td>
        <td className="lb-td lb-right font-semibold text-atx-blue font-atx-mono">
          {entry.attribution_score || 0}
        </td>
        <td className="lb-td lb-right font-semibold text-atx-mesquite font-atx-mono">
          {fmtUSD(entry.total_earned_usd || 0)}
        </td>
        <td className="lb-td lb-right lb-pts-col font-medium text-atx-ink font-atx-mono">
          {(entry.total_points || 0).toLocaleString()}
        </td>
      </tr>
    )
  }

  return (
    <>

      <div className="page-leaderboard bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
        <div className="flex items-start max-[820px]:flex-col">
          {/* ── Main column ── */}
          <div className="flex-1 p-7 pb-10 min-w-0 max-[820px]:p-4 max-[820px]:pb-5">
            {/* ── User-first hero ── */}
            <div className="border border-atx-ink mb-6 overflow-hidden relative" style={{ backgroundImage: GRID_BG }}>
              <div className="flex items-stretch px-8 py-7 relative max-[560px]:flex-col max-[560px]:gap-5">

                {/* Left: Rank number */}
                <div className="shrink-0 w-[120px] flex flex-col justify-center pr-8 max-[560px]:w-full max-[560px]:pr-0">
                  <div className={`${LABEL} mb-[10px]`}>Your rank</div>
                  {loading ? (
                    <div className="w-[80px] h-14 bg-atx-panel border border-atx-ink/20" />
                  ) : me ? (
                    <>
                      <div className={`text-[56px] font-bold leading-none font-atx-mono tracking-[-3px]${myIdx === 0 ? ' text-atx-coral' : ' text-atx-ink'}`}>
                        #{myIdx + 1}
                      </div>
                      <div className="text-[12px] text-atx-ink/45 mt-[6px] font-atx-mono">of {total}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[56px] font-bold text-atx-ink/15 leading-none font-atx-mono tracking-[-3px]">—</div>
                      <div className="text-[12px] text-atx-ink/55 mt-[6px] font-atx-mono">{total > 0 ? `${total} ranked` : ''}</div>
                    </>
                  )}
                </div>

                {/* Vertical divider */}
                <div className="w-px bg-atx-ink/20 shrink-0 self-stretch mr-8 max-[560px]:hidden" />

                {/* Right: Context */}
                <div className="flex-1 flex flex-col justify-center">
                  <div className="flex items-center gap-[7px] mb-[10px]">
                    <span className="w-[9px] h-[9px] bg-atx-acid border border-atx-ink shrink-0" />
                    <span className={LABEL}>
                      {activeCampaign?.name ?? (campaigns.length > 0 ? campaigns[0].name : 'Campaign')} · live rankings
                    </span>
                  </div>

                  {loading ? (
                    <>
                      <div className="w-[55%] h-[22px] bg-atx-panel border border-atx-ink/20 mb-[10px]" />
                      <div className="w-[75%] h-[14px] bg-atx-panel border border-atx-ink/15" />
                    </>
                  ) : me ? (
                    <>
                      <div className="text-[20px] font-bold text-atx-ink tracking-[-0.02em] mb-[6px] leading-tight">
                        {myIdx === 0 ? "You're leading the campaign." : `${(me.total_points || 0).toLocaleString()} pts earned`}
                      </div>
                      {myIdx === 0 ? (
                        <div className="text-[13px] text-atx-mesquite font-semibold font-atx-mono">First place — hold your ground.</div>
                      ) : (() => {
                        const above = sorted[myIdx - 1]
                        const gap = (above?.total_points || 0) - (me.total_points || 0)
                        return gap > 0 ? (
                          <div className="text-[13px] text-atx-ink/55 leading-relaxed">
                            <span className="text-atx-clay font-semibold font-atx-mono">{gap.toLocaleString()} pts</span> behind rank #{myIdx}
                            {daysLeft !== null && <span> · {daysLeft} day{daysLeft !== 1 ? 's' : ''} left</span>}
                          </div>
                        ) : null
                      })()}
                    </>
                  ) : (
                    <>
                      <div className="text-[20px] font-bold text-atx-ink tracking-[-0.02em] mb-[6px]">
                        {wallet ? "You're not on the board yet." : 'Connect to see your rank.'}
                      </div>
                      <div className="text-[13px] text-atx-ink/55 leading-relaxed">
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
              <span className={LABEL}>Campaign</span>
              {campaigns.length === 0
                ? <button className="py-[8px] px-4 text-[12px] font-medium font-atx-mono uppercase tracking-[0.06em] bg-atx-panel text-atx-ink/45 border border-atx-ink/25 cursor-not-allowed" disabled>Loading…</button>
                : campaigns.map(c => (
                  <button
                    key={c.id}
                    className={`py-[8px] px-4 text-[12px] cursor-pointer font-atx-mono uppercase tracking-[0.06em] border transition-colors duration-150 ${
                      c.id === activeCampaignId
                        ? 'font-semibold bg-atx-ink text-white border-atx-ink'
                        : 'font-medium bg-transparent text-atx-ink/60 border-atx-ink/25 hover:border-atx-ink hover:text-atx-ink'
                    }`}
                    onClick={() => setActiveCampaignId(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-6 max-[820px]:grid-cols-2">
              <div className="bg-atx-panel border border-atx-ink/25 p-5">
                <div className="flex items-center gap-[10px] mb-4">
                  <div className="w-8 h-8 border border-atx-ink flex items-center justify-center shrink-0">
                    <Users size={15} className="text-atx-blue" />
                  </div>
                  <div className={LABEL + ' text-[10px]'}>Participants</div>
                </div>
                <div className="text-[30px] font-bold tracking-[-0.8px] text-atx-ink font-atx-mono leading-none">{loading ? '—' : total}</div>
                <div className="text-[12px] text-atx-ink/45 mt-[6px] font-atx-mono">{total === 0 ? 'Be the first to join' : 'Ranked wallets'}</div>
              </div>
              <div className="bg-atx-panel border border-atx-ink/25 p-5">
                <div className="flex items-center gap-[10px] mb-4">
                  <div className="w-8 h-8 border border-atx-ink flex items-center justify-center shrink-0">
                    <Coins size={15} className="text-atx-mesquite" />
                  </div>
                  <div className={LABEL + ' text-[10px]'}>Pool remaining</div>
                </div>
                <div className="text-[30px] font-bold tracking-[-0.8px] text-atx-mesquite font-atx-mono leading-none">{activeCampaign?.pool_usd != null ? fmtUSD(activeCampaign.pool_usd) : '—'}</div>
                <div className="text-[12px] text-atx-ink/45 mt-[6px] font-atx-mono">{daysLeft !== null ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left` : 'Campaign pool'}</div>
              </div>
              <div className="bg-atx-panel border border-atx-ink/25 p-5">
                <div className="flex items-center gap-[10px] mb-4">
                  <div className="w-8 h-8 border border-atx-ink flex items-center justify-center shrink-0">
                    <TrendingUp size={15} className="text-atx-coral" />
                  </div>
                  <div className={LABEL + ' text-[10px]'}>Daily payout</div>
                </div>
                <div className="text-[30px] font-bold tracking-[-0.8px] text-atx-coral font-atx-mono leading-none">{activeCampaign?.daily_payout_usd != null ? fmtUSD(activeCampaign.daily_payout_usd) : '—'}</div>
                <div className="text-[12px] text-atx-ink/45 mt-[6px] font-atx-mono">distributed to earners</div>
              </div>
            </div>

            {/* Table card */}
            <div className="border border-atx-ink overflow-hidden">
              <div className="px-5 py-4 border-b border-atx-ink flex items-center justify-between bg-atx-panel">
                <div className="text-[15px] font-semibold text-atx-ink">Campaign leaderboard</div>
                <div className="text-[11px] text-atx-ink/45 font-atx-mono uppercase tracking-[0.06em]">Updates every 5 min</div>
              </div>

              {/* Sort tabs */}
              <div className="flex border-b border-atx-ink">
                {(['points', 'score', 'referrals'] as const).map(tab => (
                  <button
                    key={tab}
                    className={`py-[10px] px-4 text-[12px] cursor-pointer bg-transparent font-atx-mono uppercase tracking-[0.06em] transition-colors duration-150 border-b-2 -mb-[1px] ${
                      sortBy === tab
                        ? 'text-atx-blue border-atx-blue font-semibold'
                        : 'text-atx-ink/55 border-transparent hover:text-atx-ink'
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
                    <th className={`${TH} text-left w-12`}>#</th>
                    <th className={`${TH} text-left`}>Wallet</th>
                    <th className={`${TH} text-right`}>Score</th>
                    <th className={`${TH} text-right`}>Earned</th>
                    <th className={`lb-pts-col ${TH} text-right`}>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-4">
                        {[1, 2, 3, 4, 5].map(i => (
                          <div key={i} className="h-11 bg-atx-bone border border-atx-ink/15 mb-2" />
                        ))}
                      </td>
                    </tr>
                  ) : sorted.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-atx-ink/55 text-[14px] font-atx-mono">
                        No participants yet — be the first!
                        <span className="text-[12px] block mt-[6px] text-atx-ink/45">
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
          <div className="w-[300px] shrink-0 p-7 py-7 px-5 border-l border-atx-ink/20 max-[820px]:w-full max-[820px]:border-l-0 max-[820px]:border-t max-[820px]:p-5">

            {/* How to earn */}
            {activeCampaign?.actions && Object.keys(activeCampaign.actions).length > 0 && (
              <div className="border border-atx-ink/25 bg-atx-panel mt-5 p-3">
                <div className={`${LABEL} mb-3`}>How to earn points</div>
                {Object.entries(activeCampaign.actions).map(([key, action]) => {
                  const suffix = action.per_day ? '/day' : action.per_referral ? '/ref' : action.per_referred_trade ? '/trade' : ''
                  const dotColors: Record<string, string> = {
                    trade: 'var(--color-atx-mesquite)',
                    bridge: 'var(--color-atx-blue)',
                    hold: 'var(--color-atx-clay)',
                  }
                  const dotColor = key.startsWith('referral') ? 'var(--color-atx-coral)' : (dotColors[key] ?? 'var(--color-atx-blue)')
                  return (
                    <div key={key} className="flex items-center gap-[10px] py-[10px] border-b border-atx-ink/12 last:border-b-0">
                      <div className="w-2 h-2 border border-atx-ink shrink-0" style={{ background: dotColor }} />
                      <div className="flex-1 text-[13px] text-atx-ink/60">{action.label}</div>
                      <div className="text-[13px] font-bold text-atx-blue font-atx-mono">+{action.points}{suffix}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Invite */}
            {wallet && (
              <div className="mt-5">
                <div className="border border-atx-ink/25 bg-atx-panel p-[14px]">
                  <div className={`${LABEL} mb-2`}>Invite friends</div>
                  <div className="text-[13px] text-atx-ink/60 mb-3">Share your link to earn +60 pts per completed referral</div>
                  <div className="bg-atx-bone border border-atx-ink/25 p-[9px_12px] text-[11px] font-atx-mono text-atx-ink/60 flex items-center justify-between">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">{refLink}</span>
                    <button
                      className="text-[11px] text-atx-blue cursor-pointer font-atx-mono bg-transparent border-0 font-semibold uppercase tracking-[0.04em] shrink-0 ml-2"
                      onClick={copyLink}
                    >
                      {linkCopied ? 'Copied' : 'Copy'}
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

'use client'

// =============================================================================
// app/manage/[campaign_id]/page.tsx — Campaign management dashboard
//
// Access guard:
//   No wallet → "Connect wallet to manage"
//   Wallet !== campaign.creator → "Access denied"
//
// Sections:
//   1. Header — back link, name/badges, pause/resume/end controls
//   2. Stats row — 4 cards: pool remaining, participants, volume, paid out
//   3. Token pool section (if campaign_type === 'token_pool')
//      — rate chips, top referrers table, recent transactions
//   4. Points section (if campaign_type === 'points')
//      — current epoch, leaderboard, epoch history
//   5. Danger zone — End Campaign (collapsed, confirm by typing name)
//
// Data: GET /api/campaigns/manage?campaign_id=&wallet=
//       POST /api/campaigns/manage  { campaign_id, action, wallet }
// =============================================================================

import { useAccount } from 'wagmi'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { fmtUSD } from '@/lib/web2/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ManageStats {
  pool_remaining_usd: number | null
  participant_count:  number
  total_volume_usd:   number
  total_paid_out_usd: number
  days_remaining:     number | null
}

interface TopReferrer {
  wallet:   string
  referred: number
  earned:   number
}

interface RecentTx {
  time:       string
  wallet:     string
  amount_usd: number
  tx_hash:    string
}

interface LeaderboardEntry {
  rank:        number
  wallet:      string
  points:      number
  est_payout:  number
}

interface EpochEntry {
  epoch_number: number
  date:         string | null
  participants: number
  paid_out_usd: number
  status:       string
}

interface ManageData {
  campaign:      Record<string, unknown>
  stats:         ManageStats
  top_referrers?: TopReferrer[]
  recent_txs?:   RecentTx[]
  leaderboard?:  LeaderboardEntry[]
  epoch_history?: EpochEntry[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shortAddr(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-[#E0DFFF] rounded-md p-5 flex-1 min-w-0">
      <div className="font-mono text-[22px] font-bold text-[#1A1A2E] mb-1 tracking-[-0.5px]">
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[11px] text-mw-ink-4 mb-1">
          {sub}
        </div>
      )}
      <div className="font-sans text-[12px] text-mw-ink-4">
        {label}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function ManageSkeleton() {
  const block = (h: number, w = '100%') => (
    <div style={{ height: h, background: '#F0EFFF', borderRadius: 8, width: w }} />
  )
  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white border border-[#E0DFFF] rounded-[18px] p-7">
        {block(28, '40%')}
        <div className="mt-3 flex gap-2">
          {block(22, '80px')}{block(22, '80px')}
        </div>
      </div>
      <div className="flex gap-4">
        {[1,2,3,4].map(i => (
          <div key={i} className="flex-1 bg-white border border-[#E0DFFF] rounded-md p-5">
            {block(24)}
            <div className="mt-2">{block(14, '55%')}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page content
// ---------------------------------------------------------------------------
function ManageContent() {
  const { address }    = useAccount()
  const params         = useParams()
  const router         = useRouter()
  const campaignId     = params?.campaign_id as string

  const [data,        setData]        = useState<ManageData | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [dangerOpen,  setDangerOpen]  = useState(false)
  const [confirmName, setConfirmName] = useState('')

  const fetchData = useCallback(async () => {
    if (!campaignId || !address) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/campaigns/manage?campaign_id=${encodeURIComponent(campaignId)}&wallet=${encodeURIComponent(address)}`
      )
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to load campaign')
        return
      }
      setData(json as ManageData)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [campaignId, address])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Campaign action (pause / resume / end) ───────────────────────────────
  const handleAction = async (action: 'pause' | 'resume' | 'end') => {
    if (!address || !campaignId) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/campaigns/manage', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ campaign_id: campaignId, action, wallet: address }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? 'Action failed')
        return
      }
      // Update local status optimistically
      if (data) {
        setData({ ...data, campaign: { ...data.campaign, status: json.status } })
      }
      if (action === 'end') setDangerOpen(false)
    } finally {
      setActionLoading(false)
    }
  }

  // ── No wallet ─────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="min-h-screen bg-[#F7F6FF]">
        <MwNav />
        <main className="max-w-[760px] mx-auto px-4 pt-12 text-center">
          <div className="text-[32px] mb-3 text-[#C4C3F0]">◎</div>
          <div className="font-sans text-[16px] font-bold text-[#1A1A2E]">
            Connect wallet to manage
          </div>
        </main>
      </div>
    )
  }

  const campaign = data?.campaign
  const status   = (campaign?.status as string) ?? ''
  const campName = (campaign?.name as string) ?? ''
  const campType = (campaign?.campaign_type as string) ?? ''

  return (
    <div className="min-h-screen bg-[#F7F6FF] font-sans">
      <MwNav />

      <main className="max-w-[760px] mx-auto px-4 py-8">

        {/* ── Back link ── */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-[6px] font-sans text-[13px] font-semibold text-mw-ink-4 no-underline mb-5 hover:text-mw-brand-deep transition-colors duration-150"
        >
          ← Back to Dashboard
        </Link>

        {/* ── Error / access denied ── */}
        {error && !loading && (
          <div className="px-6 py-5 bg-[rgba(194,83,122,0.06)] border border-[rgba(194,83,122,0.15)] rounded-md font-sans text-[14px] text-mw-pink mb-6 text-center">
            {error.includes('Access denied')
              ? '🔒 Access denied — you are not the creator of this campaign'
              : `⚠ ${error}`}
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && <ManageSkeleton />}

        {/* ── Content ── */}
        {!loading && !error && campaign && (
          <>
            {/* ── 1. HEADER ── */}
            <div className="bg-white border border-[#E0DFFF] rounded-lg p-6 mb-5">
              <div className="flex items-start justify-between flex-wrap gap-4">

                {/* Name + badges */}
                <div>
                  <h1 className="font-sans text-[22px] font-extrabold text-[#1A1A2E] mt-0 mb-[10px]">
                    {campName}
                  </h1>
                  <div className="flex gap-2 flex-wrap">
                    {/* Chain badge */}
                    <span className="inline-block font-sans text-[12px] font-bold px-3 py-1 rounded-xl border text-mw-brand-deep border-[rgba(58,92,232,0.2)] bg-[#EEF1FF]">
                      {campaign.chain as string}
                    </span>
                    {/* Type badge */}
                    <span className="inline-block font-sans text-[12px] font-bold px-3 py-1 rounded-xl border text-[#7B6FCC] border-[rgba(123,111,204,0.2)] bg-[rgba(123,111,204,0.08)]">
                      {campType === 'token_pool' ? 'Token Pool' : 'Points'}
                    </span>
                    {/* Status badge */}
                    {status === 'live' && (
                      <span className="inline-block font-sans text-[12px] font-bold px-3 py-1 rounded-xl border text-mw-teal border-[rgba(42,158,138,0.2)] bg-[rgba(42,158,138,0.08)]">
                        ● Live
                      </span>
                    )}
                    {status === 'paused' && (
                      <span className="inline-block font-sans text-[12px] font-bold px-3 py-1 rounded-xl border text-mw-amber border-[rgba(194,122,0,0.2)] bg-[rgba(194,122,0,0.08)]">
                        ⏸ Paused
                      </span>
                    )}
                    {status === 'ended' && (
                      <span className="inline-block font-sans text-[12px] font-bold px-3 py-1 rounded-xl border text-mw-ink-4 border-[#E0DFFF] bg-[#F7F6FF]">
                        Ended
                      </span>
                    )}
                    {status === 'upcoming' && (
                      <span className="inline-block font-sans text-[12px] font-bold px-3 py-1 rounded-xl border text-mw-amber border-[rgba(194,122,0,0.2)] bg-[rgba(194,122,0,0.08)]">
                        ◷ Upcoming
                      </span>
                    )}
                  </div>
                </div>

                {/* Pause / Resume button */}
                <div>
                  {status === 'live' && (
                    <button
                      disabled={actionLoading}
                      onClick={() => handleAction('pause')}
                      className="font-sans text-[13px] font-bold border-none rounded-sm px-[18px] py-[9px] cursor-pointer transition-opacity duration-150 bg-mw-amber text-white disabled:opacity-40 disabled:cursor-not-allowed hover:not-disabled:opacity-85"
                    >
                      ⏸ Pause Campaign
                    </button>
                  )}
                  {status === 'paused' && (
                    <button
                      disabled={actionLoading}
                      onClick={() => handleAction('resume')}
                      className="font-sans text-[13px] font-bold border-none rounded-sm px-[18px] py-[9px] cursor-pointer transition-opacity duration-150 bg-mw-teal text-white disabled:opacity-40 disabled:cursor-not-allowed hover:not-disabled:opacity-85"
                    >
                      ▶ Resume Campaign
                    </button>
                  )}
                  {status === 'ended' && (
                    <button
                      disabled
                      className="font-sans text-[13px] font-bold border-none rounded-sm px-[18px] py-[9px] cursor-not-allowed opacity-40 bg-[#F0EFFF] text-[#C4C3F0]"
                    >
                      Campaign Ended
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* ── 2. STATS ROW ── */}
            <div className="flex gap-4 flex-wrap mb-5">
              <StatCard
                label="Pool Remaining"
                value={data!.stats.pool_remaining_usd != null
                  ? fmtUSD(data!.stats.pool_remaining_usd)
                  : '—'}
              />
              <StatCard
                label="Participants"
                value={data!.stats.participant_count.toLocaleString()}
              />
              <StatCard
                label="Total Volume"
                value={fmtUSD(data!.stats.total_volume_usd)}
              />
              <StatCard
                label="Paid Out"
                value={fmtUSD(data!.stats.total_paid_out_usd)}
                sub={data!.stats.days_remaining != null
                  ? `${data!.stats.days_remaining}d remaining`
                  : undefined}
              />
            </div>

            {/* ── 3. TOKEN POOL SECTION ── */}
            {campType === 'token_pool' && (
              <div className="bg-white border border-[#E0DFFF] rounded-lg p-6 mb-5">
                <h2 className="font-sans text-[16px] font-bold text-[#1A1A2E] mt-0 mb-4">Token Reward Pool</h2>

                {/* Rate chips */}
                <div className="flex gap-2 flex-wrap mb-5">
                  <span className="inline-block font-sans text-[12px] font-bold px-3 py-1 rounded-xl border text-mw-teal border-[rgba(42,158,138,0.2)] bg-[rgba(42,158,138,0.07)]">
                    Buyer {campaign.buyer_reward_pct as number ?? 0}%
                  </span>
                  <span className="inline-block font-sans text-[12px] font-bold px-3 py-1 rounded-xl border text-[#7B6FCC] border-[rgba(123,111,204,0.2)] bg-[rgba(123,111,204,0.07)]">
                    Referral {campaign.referral_reward_pct as number ?? 0}%
                  </span>
                  <span className="inline-block font-sans text-[12px] font-bold px-3 py-1 rounded-xl border text-mw-ink-4 border-[#E0DFFF] bg-[#F7F6FF]">
                    Platform 2%
                  </span>
                </div>

                {/* Burn rate */}
                {data!.stats.total_volume_usd > 0 && data!.stats.pool_remaining_usd != null && (
                  <div className="px-4 py-3 bg-[#FFFBF0] border border-[rgba(194,122,0,0.15)] rounded-[10px] font-sans text-[13px] text-mw-amber mb-6">
                    {(() => {
                      const dailyRate = data!.stats.total_volume_usd / Math.max(1, 30) *
                        ((campaign.buyer_reward_pct as number ?? 0) +
                         (campaign.referral_reward_pct as number ?? 0) + 2) / 100
                      const daysLeft = dailyRate > 0
                        ? Math.round(data!.stats.pool_remaining_usd! / dailyRate)
                        : null
                      return daysLeft != null
                        ? `Pool depletes in ~${daysLeft} day${daysLeft !== 1 ? 's' : ''} at current volume`
                        : 'Pool burn rate: no volume yet'
                    })()}
                  </div>
                )}

                {/* Top referrers */}
                <h3 className="font-sans text-[14px] font-bold text-[#1A1A2E] mt-0 mb-3">
                  Top Referrers
                </h3>
                {!data!.top_referrers || data!.top_referrers.length === 0 ? (
                  <div className="font-sans text-[13px] text-mw-ink-4 py-4">
                    No referrals yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto mb-6">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Wallet</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Referred</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Earned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.top_referrers.map((r, i) => (
                          <tr key={i} className="hover:bg-[#FAFAFF]">
                            <td className="px-3 py-[10px] font-mono text-[12px] text-[#1A1A2E] border-b border-[#F0EFFF] last:border-b-0">{shortAddr(r.wallet)}</td>
                            <td className="px-3 py-[10px] font-mono text-[13px] text-[#1A1A2E] border-b border-[#F0EFFF] last:border-b-0">{r.referred}</td>
                            <td className="px-3 py-[10px] font-mono text-[13px] text-[#1A1A2E] border-b border-[#F0EFFF] last:border-b-0">{fmtUSD(r.earned)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Recent transactions */}
                <h3 className="font-sans text-[14px] font-bold text-[#1A1A2E] mt-0 mb-3">
                  Recent Transactions
                </h3>
                {!data!.recent_txs || data!.recent_txs.length === 0 ? (
                  <div className="font-sans text-[13px] text-mw-ink-4 py-4">
                    No transactions yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Time</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Wallet</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Swap $</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Reward $</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.recent_txs.map((tx, i) => (
                          <tr key={i} className="hover:bg-[#FAFAFF]">
                            <td className="px-3 py-[10px] font-mono text-[12px] text-mw-ink-4 border-b border-[#F0EFFF]">{fmtTime(tx.time)}</td>
                            <td className="px-3 py-[10px] font-mono text-[12px] text-[#1A1A2E] border-b border-[#F0EFFF]">{shortAddr(tx.wallet)}</td>
                            <td className="px-3 py-[10px] font-mono text-[13px] text-[#1A1A2E] border-b border-[#F0EFFF]">{fmtUSD(tx.amount_usd)}</td>
                            <td className="px-3 py-[10px] font-mono text-[13px] text-mw-teal border-b border-[#F0EFFF]">
                              {fmtUSD(tx.amount_usd *
                                ((campaign.buyer_reward_pct as number ?? 0) / 100))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── 4. POINTS SECTION ── */}
            {campType === 'points' && (
              <div className="bg-white border border-[#E0DFFF] rounded-lg p-6 mb-5">
                <h2 className="font-sans text-[16px] font-bold text-[#1A1A2E] mt-0 mb-4">Points Campaign</h2>

                {/* Leaderboard */}
                <h3 className="font-sans text-[14px] font-bold text-[#1A1A2E] mt-0 mb-3">
                  Leaderboard
                </h3>
                {!data!.leaderboard || data!.leaderboard.length === 0 ? (
                  <div className="font-sans text-[13px] text-mw-ink-4 py-4 mb-6">
                    No participants yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto mb-6">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">#</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Wallet</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Points</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Est. Payout</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.leaderboard.map(row => (
                          <tr key={row.rank} className="hover:bg-[#FAFAFF]">
                            <td className={`px-3 py-[10px] font-mono text-[13px] border-b border-[#F0EFFF] ${row.rank <= 3 ? 'text-mw-brand-deep font-bold' : 'text-mw-ink-4 font-normal'}`}>
                              {row.rank}
                            </td>
                            <td className="px-3 py-[10px] font-mono text-[12px] text-[#1A1A2E] border-b border-[#F0EFFF]">{shortAddr(row.wallet)}</td>
                            <td className="px-3 py-[10px] font-mono text-[13px] text-[#1A1A2E] border-b border-[#F0EFFF]">{row.points.toLocaleString()}</td>
                            <td className="px-3 py-[10px] font-mono text-[13px] text-mw-teal border-b border-[#F0EFFF]">{fmtUSD(row.est_payout)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Epoch history */}
                <h3 className="font-sans text-[14px] font-bold text-[#1A1A2E] mt-0 mb-3">
                  Epoch History
                </h3>
                {!data!.epoch_history || data!.epoch_history.length === 0 ? (
                  <div className="font-sans text-[13px] text-mw-ink-4 py-4">
                    No epoch distributions yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Epoch</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Date</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Participants</th>
                          <th className="text-left px-3 py-[10px] font-sans text-[11px] font-bold text-mw-ink-4 uppercase tracking-[0.4px] border-b border-[#E0DFFF]">Paid Out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.epoch_history.map((ep, i) => (
                          <tr key={i} className="hover:bg-[#FAFAFF]">
                            <td className="px-3 py-[10px] font-mono text-[13px] text-[#1A1A2E] border-b border-[#F0EFFF]">#{ep.epoch_number}</td>
                            <td className="px-3 py-[10px] font-mono text-[12px] text-mw-ink-4 border-b border-[#F0EFFF]">{fmtDate(ep.date)}</td>
                            <td className="px-3 py-[10px] font-mono text-[13px] text-[#1A1A2E] border-b border-[#F0EFFF]">{ep.participants}</td>
                            <td className="px-3 py-[10px] font-mono text-[13px] text-[#1A1A2E] border-b border-[#F0EFFF]">{fmtUSD(ep.paid_out_usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── 5. DANGER ZONE ── */}
            <div className="border border-mw-pink bg-[rgba(194,83,122,0.04)] rounded-lg overflow-hidden mb-10">
              {/* Collapsed header / toggle */}
              <button
                onClick={() => setDangerOpen(!dangerOpen)}
                className="w-full px-6 py-4 bg-transparent border-none cursor-pointer flex items-center justify-between"
              >
                <span className="font-sans text-[14px] font-bold text-mw-pink">
                  ⚠ Danger Zone
                </span>
                <span className="text-mw-pink text-[16px]">
                  {dangerOpen ? '▲' : '▼'}
                </span>
              </button>

              {dangerOpen && (
                <div className="px-6 pb-6">
                  <p className="font-sans text-[13px] text-mw-ink-4 mt-0 mb-4">
                    Ending the campaign will immediately stop all reward accrual.
                    Remaining pool can be withdrawn after ending.
                  </p>

                  <div className="mb-3">
                    <label className="font-sans text-[12px] font-semibold text-mw-pink block mb-[6px]">
                      Type campaign name to confirm: <strong>{campName}</strong>
                    </label>
                    <input
                      type="text"
                      value={confirmName}
                      onChange={e => setConfirmName(e.target.value)}
                      placeholder={campName}
                      className="w-full px-[14px] py-[10px] border border-[rgba(194,83,122,0.3)] rounded-sm text-[13px] font-sans outline-none bg-white box-border"
                    />
                  </div>

                  <button
                    disabled={confirmName !== campName || actionLoading || status === 'ended'}
                    onClick={() => handleAction('end')}
                    className={`font-sans text-[13px] font-bold border-none rounded-sm px-[18px] py-[9px] cursor-pointer transition-opacity duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${confirmName === campName && status !== 'ended' ? 'bg-mw-pink text-white' : 'bg-[#F0EFFF] text-[#C4C3F0]'}`}
                  >
                    End Campaign Early
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default function ManagePage() {
  return (
    <MwAuthGuard>
      <ManageContent />
    </MwAuthGuard>
  )
}

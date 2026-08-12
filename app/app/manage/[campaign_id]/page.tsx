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

import { useAccount, useSignMessage } from 'wagmi'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { fmtUSD } from '@/lib/web2/api'
import { buildCampaignManageMessage, buildCampaignManageViewMessage } from '@/lib/web3/signedActionMessages'

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
    <div className="bg-atx-panel border border-atx-ink/20 rounded-md p-5 flex-1 min-w-0">
      <div className="font-atx-mono text-[22px] font-bold text-atx-ink mb-1 tracking-[-0.5px]">
        {value}
      </div>
      {sub && (
        <div className="font-atx-mono text-[11px] text-atx-ink/55 mb-1">
          {sub}
        </div>
      )}
      <div className="font-atx-display text-[12px] text-atx-ink/55">
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
    <div style={{ height: h, background: 'var(--color-atx-bone)', borderRadius: 0, border: '1px solid rgba(17,17,17,0.15)', width: w }} />
  )
  return (
    <div className="flex flex-col gap-5">
      <div className="bg-atx-panel border border-atx-ink/20 rounded-[18px] p-7">
        {block(28, '40%')}
        <div className="mt-3 flex gap-2">
          {block(22, '80px')}{block(22, '80px')}
        </div>
      </div>
      <div className="flex gap-4">
        {[1,2,3,4].map(i => (
          <div key={i} className="flex-1 bg-atx-panel border border-atx-ink/20 rounded-md p-5">
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
  const { signMessageAsync } = useSignMessage()
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
      const issuedAt = Date.now()
      const authMessage = buildCampaignManageViewMessage({
        campaignId,
        wallet: address,
        issuedAt,
      })
      const authSignature = await signMessageAsync({ message: authMessage })
      const res = await fetch(
        `/api/campaigns/manage?campaign_id=${encodeURIComponent(campaignId)}&wallet=${encodeURIComponent(address)}&issuedAt=${encodeURIComponent(String(issuedAt))}&authMessage=${encodeURIComponent(authMessage)}&authSignature=${encodeURIComponent(authSignature)}`
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
  }, [campaignId, address, signMessageAsync])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Campaign action (pause / resume / end) ───────────────────────────────
  const handleAction = async (action: 'pause' | 'resume' | 'end') => {
    if (!address || !campaignId) return
    setActionLoading(true)
    try {
      const issuedAt = Date.now()
      const authMessage = buildCampaignManageMessage({
        campaignId,
        wallet: address,
        action,
        issuedAt,
      })
      const authSignature = await signMessageAsync({ message: authMessage })
      const res = await fetch('/api/campaigns/manage', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ campaign_id: campaignId, action, wallet: address, issuedAt, authMessage, authSignature }),
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
      <div className="min-h-screen bg-atx-bone font-atx-display text-atx-ink [&_*]:rounded-none">
        <MwNav />
        <main className="max-w-[760px] mx-auto px-4 pt-12 text-center">
          <svg viewBox="0 0 100 100" className="w-8 h-8 text-atx-coral mx-auto mb-3" aria-hidden="true">
            <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
          </svg>
          <div className="text-[16px] font-bold text-atx-ink">
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
    <div className="min-h-screen bg-atx-bone font-atx-display text-atx-ink [&_*]:rounded-none">
      <MwNav />

      <main className="max-w-[760px] mx-auto px-4 py-8">

        {/* ── Back link ── */}
        <Link
          href="/app/rewards"
          className="inline-flex items-center gap-[6px] font-atx-display text-[13px] font-semibold text-atx-ink/55 no-underline mb-5 hover:text-atx-blue transition-colors duration-150"
        >
          ← Back to Dashboard
        </Link>

        {/* ── Error / access denied ── */}
        {error && !loading && (
          <div className="px-6 py-5 bg-atx-panel border border-atx-clay font-atx-mono text-[14px] text-atx-clay mb-6 text-center">
            {error.includes('Access denied')
              ? 'Access denied — you are not the creator of this campaign'
              : error}
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && <ManageSkeleton />}

        {/* ── Content ── */}
        {!loading && !error && campaign && (
          <>
            {/* ── 1. HEADER ── */}
            <div className="bg-atx-panel border border-atx-ink/20 rounded-lg p-6 mb-5">
              <div className="flex items-start justify-between flex-wrap gap-4">

                {/* Name + badges */}
                <div>
                  <h1 className="font-atx-display text-[22px] font-extrabold text-atx-ink mt-0 mb-[10px]">
                    {campName}
                  </h1>
                  <div className="flex gap-2 flex-wrap">
                    {/* Chain badge */}
                    <span className="inline-block font-atx-display text-[12px] font-bold px-3 py-1 rounded-xl border text-atx-blue border-atx-ink/30">
                      {campaign.chain as string}
                    </span>
                    {/* Type badge */}
                    <span className="inline-block font-atx-display text-[12px] font-bold px-3 py-1 rounded-xl border text-atx-blue border-atx-ink/30">
                      {campType === 'token_pool' ? 'Token Pool' : 'Points'}
                    </span>
                    {/* Status badge */}
                    {status === 'live' && (
                      <span className="inline-block font-atx-display text-[12px] font-bold px-3 py-1 rounded-xl border text-atx-mesquite border-atx-ink/30">
                        Live
                      </span>
                    )}
                    {status === 'paused' && (
                      <span className="inline-block font-atx-display text-[12px] font-bold px-3 py-1 rounded-xl border text-atx-clay border-atx-ink/30">
                        Paused
                      </span>
                    )}
                    {status === 'ended' && (
                      <span className="inline-block font-atx-display text-[12px] font-bold px-3 py-1 rounded-xl border text-atx-ink/55 border-atx-ink/30">
                        Ended
                      </span>
                    )}
                    {status === 'upcoming' && (
                      <span className="inline-block font-atx-display text-[12px] font-bold px-3 py-1 rounded-xl border text-atx-clay border-atx-ink/30">
                        Upcoming
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
                      className="font-atx-display text-[13px] font-bold border-none rounded-sm px-[18px] py-[9px] cursor-pointer transition-opacity duration-150 bg-atx-clay text-white border border-atx-ink disabled:opacity-40 disabled:cursor-not-allowed hover:not-disabled:opacity-85"
                    >
                      Pause Campaign
                    </button>
                  )}
                  {status === 'paused' && (
                    <button
                      disabled={actionLoading}
                      onClick={() => handleAction('resume')}
                      className="font-atx-display text-[13px] font-bold border-none rounded-sm px-[18px] py-[9px] cursor-pointer transition-opacity duration-150 bg-atx-mesquite text-white border border-atx-ink disabled:opacity-40 disabled:cursor-not-allowed hover:not-disabled:opacity-85"
                    >
                      Resume Campaign
                    </button>
                  )}
                  {status === 'ended' && (
                    <button
                      disabled
                      className="font-atx-display text-[13px] font-bold border-none rounded-sm px-[18px] py-[9px] cursor-not-allowed opacity-40 bg-atx-bone text-atx-ink/40"
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
              <div className="bg-atx-panel border border-atx-ink/20 rounded-lg p-6 mb-5">
                <h2 className="font-atx-display text-[16px] font-bold text-atx-ink mt-0 mb-4">Token Reward Pool</h2>

                {/* Rate chips */}
                <div className="flex gap-2 flex-wrap mb-5">
                  <span className="inline-block font-atx-display text-[12px] font-bold px-3 py-1 rounded-xl border text-atx-mesquite border-atx-ink/30">
                    Buyer {campaign.buyer_reward_pct as number ?? 0}%
                  </span>
                  <span className="inline-block font-atx-display text-[12px] font-bold px-3 py-1 rounded-xl border text-atx-blue border-atx-ink/30">
                    Referral {campaign.referral_reward_pct as number ?? 0}%
                  </span>
                  <span className="inline-block font-atx-display text-[12px] font-bold px-3 py-1 rounded-xl border text-atx-ink/55 border-atx-ink/30">
                    Platform 2%
                  </span>
                </div>

                {/* Burn rate */}
                {data!.stats.total_volume_usd > 0 && data!.stats.pool_remaining_usd != null && (
                  <div className="px-4 py-3 bg-atx-bone border border-atx-clay/40 rounded-[10px] font-atx-display text-[13px] text-atx-clay mb-6">
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
                <h3 className="font-atx-display text-[14px] font-bold text-atx-ink mt-0 mb-3">
                  Top Referrers
                </h3>
                {!data!.top_referrers || data!.top_referrers.length === 0 ? (
                  <div className="font-atx-display text-[13px] text-atx-ink/55 py-4">
                    No referrals yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto mb-6">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Wallet</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Referred</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Earned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.top_referrers.map((r, i) => (
                          <tr key={i} className="hover:bg-atx-bone">
                            <td className="px-3 py-[10px] font-atx-mono text-[12px] text-atx-ink border-b border-atx-ink/12 last:border-b-0">{shortAddr(r.wallet)}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[13px] text-atx-ink border-b border-atx-ink/12 last:border-b-0">{r.referred}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[13px] text-atx-ink border-b border-atx-ink/12 last:border-b-0">{fmtUSD(r.earned)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Recent transactions */}
                <h3 className="font-atx-display text-[14px] font-bold text-atx-ink mt-0 mb-3">
                  Recent Transactions
                </h3>
                {!data!.recent_txs || data!.recent_txs.length === 0 ? (
                  <div className="font-atx-display text-[13px] text-atx-ink/55 py-4">
                    No transactions yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Time</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Wallet</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Swap $</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Reward $</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.recent_txs.map((tx, i) => (
                          <tr key={i} className="hover:bg-atx-bone">
                            <td className="px-3 py-[10px] font-atx-mono text-[12px] text-atx-ink/55 border-b border-atx-ink/12">{fmtTime(tx.time)}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[12px] text-atx-ink border-b border-atx-ink/12">{shortAddr(tx.wallet)}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[13px] text-atx-ink border-b border-atx-ink/12">{fmtUSD(tx.amount_usd)}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[13px] text-atx-mesquite border-b border-atx-ink/12">
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
              <div className="bg-atx-panel border border-atx-ink/20 rounded-lg p-6 mb-5">
                <h2 className="font-atx-display text-[16px] font-bold text-atx-ink mt-0 mb-4">Points Campaign</h2>

                {/* Leaderboard */}
                <h3 className="font-atx-display text-[14px] font-bold text-atx-ink mt-0 mb-3">
                  Leaderboard
                </h3>
                {!data!.leaderboard || data!.leaderboard.length === 0 ? (
                  <div className="font-atx-display text-[13px] text-atx-ink/55 py-4 mb-6">
                    No participants yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto mb-6">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">#</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Wallet</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Points</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Est. Payout</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.leaderboard.map(row => (
                          <tr key={row.rank} className="hover:bg-atx-bone">
                            <td className={`px-3 py-[10px] font-atx-mono text-[13px] border-b border-atx-ink/12 ${row.rank <= 3 ? 'text-atx-blue font-bold' : 'text-atx-ink/55 font-normal'}`}>
                              {row.rank}
                            </td>
                            <td className="px-3 py-[10px] font-atx-mono text-[12px] text-atx-ink border-b border-atx-ink/12">{shortAddr(row.wallet)}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[13px] text-atx-ink border-b border-atx-ink/12">{row.points.toLocaleString()}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[13px] text-atx-mesquite border-b border-atx-ink/12">{fmtUSD(row.est_payout)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Epoch history */}
                <h3 className="font-atx-display text-[14px] font-bold text-atx-ink mt-0 mb-3">
                  Epoch History
                </h3>
                {!data!.epoch_history || data!.epoch_history.length === 0 ? (
                  <div className="font-atx-display text-[13px] text-atx-ink/55 py-4">
                    No epoch distributions yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Epoch</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Date</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Participants</th>
                          <th className="text-left px-3 py-[10px] font-atx-display text-[11px] font-bold text-atx-ink/55 uppercase tracking-[0.4px] border-b border-atx-ink">Paid Out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.epoch_history.map((ep, i) => (
                          <tr key={i} className="hover:bg-atx-bone">
                            <td className="px-3 py-[10px] font-atx-mono text-[13px] text-atx-ink border-b border-atx-ink/12">#{ep.epoch_number}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[12px] text-atx-ink/55 border-b border-atx-ink/12">{fmtDate(ep.date)}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[13px] text-atx-ink border-b border-atx-ink/12">{ep.participants}</td>
                            <td className="px-3 py-[10px] font-atx-mono text-[13px] text-atx-ink border-b border-atx-ink/12">{fmtUSD(ep.paid_out_usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── 5. DANGER ZONE ── */}
            <div className="border border-atx-clay bg-atx-panel rounded-lg overflow-hidden mb-10">
              {/* Collapsed header / toggle */}
              <button
                onClick={() => setDangerOpen(!dangerOpen)}
                className="w-full px-6 py-4 bg-transparent border-none cursor-pointer flex items-center justify-between"
              >
                <span className="font-atx-display text-[14px] font-bold text-atx-clay">
                  Danger Zone
                </span>
                <span className="text-atx-clay text-[16px]">
                  {dangerOpen ? '▲' : '▼'}
                </span>
              </button>

              {dangerOpen && (
                <div className="px-6 pb-6">
                  <p className="font-atx-display text-[13px] text-atx-ink/55 mt-0 mb-4">
                    Ending the campaign will immediately stop all reward accrual.
                    Remaining pool can be withdrawn after ending.
                  </p>

                  <div className="mb-3">
                    <label className="font-atx-display text-[12px] font-semibold text-atx-clay block mb-[6px]">
                      Type campaign name to confirm: <strong>{campName}</strong>
                    </label>
                    <input
                      type="text"
                      value={confirmName}
                      onChange={e => setConfirmName(e.target.value)}
                      placeholder={campName}
                      className="w-full px-[14px] py-[10px] border border-atx-ink/30 rounded-sm text-[13px] font-atx-display outline-none bg-atx-panel box-border"
                    />
                  </div>

                  <button
                    disabled={confirmName !== campName || actionLoading || status === 'ended'}
                    onClick={() => handleAction('end')}
                    className={`font-atx-display text-[13px] font-bold border-none rounded-sm px-[18px] py-[9px] cursor-pointer transition-opacity duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${confirmName === campName && status !== 'ended' ? 'bg-atx-clay text-white border border-atx-ink' : 'bg-atx-bone text-atx-ink/40'}`}
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

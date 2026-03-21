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
//
// Inline styles only — no Tailwind. DM Mono for numbers, Plus Jakarta Sans for UI.
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
    <div style={{
      background: '#fff', border: '1px solid #E0DFFF',
      borderRadius: 12, padding: 20, flex: 1, minWidth: 0,
    }}>
      <div style={{
        fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 700,
        color: '#1A1A2E', marginBottom: 4, letterSpacing: '-0.5px',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#8A8C9E', marginBottom: 4,
        }}>
          {sub}
        </div>
      )}
      <div style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12, color: '#8A8C9E',
      }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: '#fff', border: '1px solid #E0DFFF', borderRadius: 18, padding: 28 }}>
        {block(28, '40%')}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          {block(22, '80px')}{block(22, '80px')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        {[1,2,3,4].map(i => <div key={i} style={{ flex: 1, background: '#fff', border: '1px solid #E0DFFF', borderRadius: 12, padding: 20 }}>{block(24)}<div style={{marginTop:8}}>{block(14,'55%')}</div></div>)}
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
      <div style={{ minHeight: '100vh', background: '#F7F6FF' }}>
        <MwNav />
        <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12, color: '#C4C3F0' }}>◎</div>
          <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 16, fontWeight: 700, color: '#1A1A2E' }}>
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
    <>
      <style>{`
        .mgr-table { width: 100%; border-collapse: collapse; }
        .mgr-table th {
          text-align: left; padding: 10px 12px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11px; font-weight: 700; color: #8A8C9E;
          text-transform: uppercase; letter-spacing: 0.4px;
          border-bottom: 1px solid #E0DFFF;
        }
        .mgr-table td {
          padding: 10px 12px;
          font-family: 'DM Mono', monospace;
          font-size: 13px; color: #1A1A2E;
          border-bottom: 1px solid #F0EFFF;
        }
        .mgr-table tr:last-child td { border-bottom: none; }
        .mgr-table tr:hover td { background: #FAFAFF; }
        .mgr-action-btn {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; font-weight: 700;
          border: none; border-radius: 8px;
          padding: 9px 18px; cursor: pointer;
          transition: opacity 0.15s;
        }
        .mgr-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .mgr-action-btn:hover:not(:disabled) { opacity: 0.85; }
        .mgr-stats-row {
          display: flex; gap: 16px; flex-wrap: wrap;
        }
        @media (max-width: 640px) {
          .mgr-stats-row { flex-direction: column; }
        }
        .mgr-section {
          background: #fff; border: 1px solid #E0DFFF;
          border-radius: 16px; padding: 24px;
          margin-bottom: 20px;
        }
        .mgr-section-title {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 16px; font-weight: 700; color: #1A1A2E;
          margin: 0 0 16px 0;
        }
        .mgr-chip {
          display: inline-block;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px; font-weight: 700;
          padding: 4px 12px; border-radius: 20px;
          border: 1px solid;
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#F7F6FF', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
        <MwNav />

        <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>

          {/* ── Back link ── */}
          <Link href="/dashboard" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600,
            color: '#8A8C9E', textDecoration: 'none', marginBottom: 20,
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = '#3A5CE8' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = '#8A8C9E' }}
          >
            ← Back to Dashboard
          </Link>

          {/* ── Error / access denied ── */}
          {error && !loading && (
            <div style={{
              padding: '20px 24px',
              background: 'rgba(194,83,122,0.06)', border: '1px solid rgba(194,83,122,0.15)',
              borderRadius: 12, fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 14, color: '#C2537A', marginBottom: 24, textAlign: 'center',
            }}>
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
              <div className="mgr-section" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>

                  {/* Name + badges */}
                  <div>
                    <h1 style={{
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontSize: 22, fontWeight: 800, color: '#1A1A2E',
                      margin: '0 0 10px 0',
                    }}>
                      {campName}
                    </h1>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {/* Chain badge */}
                      <span className="mgr-chip" style={{ color: '#3A5CE8', borderColor: 'rgba(58,92,232,0.2)', background: '#EEF1FF' }}>
                        {campaign.chain as string}
                      </span>
                      {/* Type badge */}
                      <span className="mgr-chip" style={{ color: '#7B6FCC', borderColor: 'rgba(123,111,204,0.2)', background: 'rgba(123,111,204,0.08)' }}>
                        {campType === 'token_pool' ? 'Token Pool' : 'Points'}
                      </span>
                      {/* Status badge */}
                      {status === 'live' && (
                        <span className="mgr-chip" style={{ color: '#2A9E8A', borderColor: 'rgba(42,158,138,0.2)', background: 'rgba(42,158,138,0.08)' }}>
                          ● Live
                        </span>
                      )}
                      {status === 'paused' && (
                        <span className="mgr-chip" style={{ color: '#C27A00', borderColor: 'rgba(194,122,0,0.2)', background: 'rgba(194,122,0,0.08)' }}>
                          ⏸ Paused
                        </span>
                      )}
                      {status === 'ended' && (
                        <span className="mgr-chip" style={{ color: '#8A8C9E', borderColor: '#E0DFFF', background: '#F7F6FF' }}>
                          Ended
                        </span>
                      )}
                      {status === 'upcoming' && (
                        <span className="mgr-chip" style={{ color: '#C27A00', borderColor: 'rgba(194,122,0,0.2)', background: 'rgba(194,122,0,0.08)' }}>
                          ◷ Upcoming
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Pause / Resume button */}
                  <div>
                    {status === 'live' && (
                      <button
                        className="mgr-action-btn"
                        disabled={actionLoading}
                        onClick={() => handleAction('pause')}
                        style={{ background: '#C27A00', color: '#fff' }}
                      >
                        ⏸ Pause Campaign
                      </button>
                    )}
                    {status === 'paused' && (
                      <button
                        className="mgr-action-btn"
                        disabled={actionLoading}
                        onClick={() => handleAction('resume')}
                        style={{ background: '#2A9E8A', color: '#fff' }}
                      >
                        ▶ Resume Campaign
                      </button>
                    )}
                    {status === 'ended' && (
                      <button
                        className="mgr-action-btn"
                        disabled
                        style={{ background: '#F0EFFF', color: '#C4C3F0' }}
                      >
                        Campaign Ended
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── 2. STATS ROW ── */}
              <div className="mgr-stats-row" style={{ marginBottom: 20 }}>
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
                <div className="mgr-section">
                  <h2 className="mgr-section-title">Token Reward Pool</h2>

                  {/* Rate chips */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                    <span className="mgr-chip" style={{ color: '#2A9E8A', borderColor: 'rgba(42,158,138,0.2)', background: 'rgba(42,158,138,0.07)' }}>
                      Buyer {campaign.buyer_reward_pct as number ?? 0}%
                    </span>
                    <span className="mgr-chip" style={{ color: '#7B6FCC', borderColor: 'rgba(123,111,204,0.2)', background: 'rgba(123,111,204,0.07)' }}>
                      Referral {campaign.referral_reward_pct as number ?? 0}%
                    </span>
                    <span className="mgr-chip" style={{ color: '#8A8C9E', borderColor: '#E0DFFF', background: '#F7F6FF' }}>
                      Platform 2%
                    </span>
                  </div>

                  {/* Burn rate */}
                  {data!.stats.total_volume_usd > 0 && data!.stats.pool_remaining_usd != null && (
                    <div style={{
                      padding: '12px 16px', background: '#FFFBF0',
                      border: '1px solid rgba(194,122,0,0.15)', borderRadius: 10,
                      fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#C27A00',
                      marginBottom: 24,
                    }}>
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
                  <h3 style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, fontWeight: 700, color: '#1A1A2E', margin: '0 0 12px 0' }}>
                    Top Referrers
                  </h3>
                  {!data!.top_referrers || data!.top_referrers.length === 0 ? (
                    <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E', padding: '16px 0' }}>
                      No referrals yet.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto', marginBottom: 24 }}>
                      <table className="mgr-table">
                        <thead>
                          <tr>
                            <th>Wallet</th>
                            <th>Referred</th>
                            <th>Earned</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data!.top_referrers.map((r, i) => (
                            <tr key={i}>
                              <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{shortAddr(r.wallet)}</td>
                              <td>{r.referred}</td>
                              <td>{fmtUSD(r.earned)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Recent transactions */}
                  <h3 style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, fontWeight: 700, color: '#1A1A2E', margin: '0 0 12px 0' }}>
                    Recent Transactions
                  </h3>
                  {!data!.recent_txs || data!.recent_txs.length === 0 ? (
                    <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E', padding: '16px 0' }}>
                      No transactions yet.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="mgr-table">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Wallet</th>
                            <th>Swap $</th>
                            <th>Reward $</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data!.recent_txs.map((tx, i) => (
                            <tr key={i}>
                              <td style={{ color: '#8A8C9E', fontSize: 12 }}>{fmtTime(tx.time)}</td>
                              <td style={{ fontSize: 12 }}>{shortAddr(tx.wallet)}</td>
                              <td>{fmtUSD(tx.amount_usd)}</td>
                              <td style={{ color: '#2A9E8A' }}>
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
                <div className="mgr-section">
                  <h2 className="mgr-section-title">Points Campaign</h2>

                  {/* Leaderboard */}
                  <h3 style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, fontWeight: 700, color: '#1A1A2E', margin: '0 0 12px 0' }}>
                    Leaderboard
                  </h3>
                  {!data!.leaderboard || data!.leaderboard.length === 0 ? (
                    <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E', padding: '16px 0', marginBottom: 24 }}>
                      No participants yet.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto', marginBottom: 24 }}>
                      <table className="mgr-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Wallet</th>
                            <th>Points</th>
                            <th>Est. Payout</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data!.leaderboard.map(row => (
                            <tr key={row.rank}>
                              <td style={{ color: row.rank <= 3 ? '#3A5CE8' : '#8A8C9E', fontWeight: row.rank <= 3 ? 700 : 400 }}>
                                {row.rank}
                              </td>
                              <td style={{ fontSize: 12 }}>{shortAddr(row.wallet)}</td>
                              <td>{row.points.toLocaleString()}</td>
                              <td style={{ color: '#2A9E8A' }}>{fmtUSD(row.est_payout)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Epoch history */}
                  <h3 style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, fontWeight: 700, color: '#1A1A2E', margin: '0 0 12px 0' }}>
                    Epoch History
                  </h3>
                  {!data!.epoch_history || data!.epoch_history.length === 0 ? (
                    <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E', padding: '16px 0' }}>
                      No epoch distributions yet.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="mgr-table">
                        <thead>
                          <tr>
                            <th>Epoch</th>
                            <th>Date</th>
                            <th>Participants</th>
                            <th>Paid Out</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data!.epoch_history.map((ep, i) => (
                            <tr key={i}>
                              <td>#{ep.epoch_number}</td>
                              <td style={{ color: '#8A8C9E', fontSize: 12 }}>{fmtDate(ep.date)}</td>
                              <td>{ep.participants}</td>
                              <td>{fmtUSD(ep.paid_out_usd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── 5. DANGER ZONE ── */}
              <div style={{
                border: '1px solid #C2537A',
                background: 'rgba(194, 83, 122, 0.04)',
                borderRadius: 16, overflow: 'hidden',
                marginBottom: 40,
              }}>
                {/* Collapsed header / toggle */}
                <button
                  onClick={() => setDangerOpen(!dangerOpen)}
                  style={{
                    width: '100%', padding: '16px 24px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}
                >
                  <span style={{
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontSize: 14, fontWeight: 700, color: '#C2537A',
                  }}>
                    ⚠ Danger Zone
                  </span>
                  <span style={{ color: '#C2537A', fontSize: 16 }}>
                    {dangerOpen ? '▲' : '▼'}
                  </span>
                </button>

                {dangerOpen && (
                  <div style={{ padding: '0 24px 24px' }}>
                    <p style={{
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontSize: 13, color: '#8A8C9E', margin: '0 0 16px 0',
                    }}>
                      Ending the campaign will immediately stop all reward accrual.
                      Remaining pool can be withdrawn after ending.
                    </p>

                    <div style={{ marginBottom: 12 }}>
                      <label style={{
                        fontFamily: 'Plus Jakarta Sans, sans-serif',
                        fontSize: 12, fontWeight: 600, color: '#C2537A',
                        display: 'block', marginBottom: 6,
                      }}>
                        Type campaign name to confirm: <strong>{campName}</strong>
                      </label>
                      <input
                        type="text"
                        value={confirmName}
                        onChange={e => setConfirmName(e.target.value)}
                        placeholder={campName}
                        style={{
                          width: '100%', padding: '10px 14px',
                          border: '1px solid rgba(194,83,122,0.3)',
                          borderRadius: 8, fontSize: 13,
                          fontFamily: 'Plus Jakarta Sans, sans-serif',
                          outline: 'none', background: '#fff',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    <button
                      className="mgr-action-btn"
                      disabled={confirmName !== campName || actionLoading || status === 'ended'}
                      onClick={() => handleAction('end')}
                      style={{
                        background: confirmName === campName && status !== 'ended'
                          ? '#C2537A' : '#F0EFFF',
                        color: confirmName === campName && status !== 'ended'
                          ? '#fff' : '#C4C3F0',
                      }}
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
    </>
  )
}

export default function ManagePage() {
  return (
    <MwAuthGuard>
      <ManageContent />
    </MwAuthGuard>
  )
}

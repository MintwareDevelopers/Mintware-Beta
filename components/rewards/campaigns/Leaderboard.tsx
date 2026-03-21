'use client'

// =============================================================================
// Leaderboard.tsx — Campaign leaderboard tab
//
// Fetches GET /leaderboard?campaign_id= on mount.
// Ranked list: rank | wallet | points | earned USD
// Top 3: gold / silver / bronze highlights
// Current wallet row: #3A5CE8 accent + left border
// =============================================================================

import { useEffect, useState } from 'react'
import { API, shortAddr, fmtUSD } from '@/lib/web2/api'

interface LbEntry {
  wallet: string
  total_points?: number
  points?: number
  total_earned_usd?: number | string
  earned_usd?: number | string
}

interface LeaderboardProps {
  campaignId: string
  walletAddress?: string  // highlight current wallet
}

const RANK_COLORS: Record<number, { bg: string; color: string; label: string }> = {
  1: { bg: 'rgba(212,175,55,0.12)', color: '#B8860B', label: '🥇' },
  2: { bg: 'rgba(160,160,170,0.12)', color: '#6B6B7A', label: '🥈' },
  3: { bg: 'rgba(176,101,57,0.12)', color: '#8B4513', label: '🥉' },
}

export function Leaderboard({ campaignId, walletAddress }: LeaderboardProps) {
  const [entries,  setEntries]  = useState<LbEntry[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    if (!campaignId) return
    setLoading(true)
    setError(null)
    fetch(`${API}/leaderboard?campaign_id=${encodeURIComponent(campaignId)}`)
      .then(r => r.json())
      .then(data => {
        const list: LbEntry[] = Array.isArray(data) ? data : (data.leaderboard ?? data.entries ?? [])
        setEntries(list)
      })
      .catch(err => setError(err.message ?? 'Failed to load leaderboard'))
      .finally(() => setLoading(false))
  }, [campaignId])

  if (loading) {
    return (
      <div style={{
        textAlign: 'center', padding: '48px 20px',
        fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E',
      }}>
        Loading leaderboard…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        padding: '20px', background: 'rgba(194,83,122,0.05)',
        border: '1px solid rgba(194,83,122,0.15)', borderRadius: 12,
        fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#C2537A',
      }}>
        {error}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '56px 20px',
        background: '#fff', border: '1px solid #E0DFFF', borderRadius: 16,
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🏆</div>
        <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 6 }}>
          No participants yet
        </div>
        <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E' }}>
          Be the first to join and top the board.
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes lb-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      {/* Header row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '44px 1fr 1fr 1fr',
        padding: '6px 16px 10px',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 10, fontWeight: 700, letterSpacing: '1px',
        textTransform: 'uppercase', color: '#8A8C9E',
      }}>
        <span>#</span>
        <span>Wallet</span>
        <span style={{ textAlign: 'right' }}>Points</span>
        <span style={{ textAlign: 'right' }}>Earned</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map((entry, idx) => {
          const rank    = idx + 1
          const rankMeta = RANK_COLORS[rank]
          const isSelf  = walletAddress && entry.wallet?.toLowerCase() === walletAddress.toLowerCase()
          const pts     = entry.total_points ?? entry.points ?? 0
          const earned  = entry.total_earned_usd ?? entry.earned_usd

          return (
            <div key={entry.wallet ?? idx} style={{
              display: 'grid',
              gridTemplateColumns: '44px 1fr 1fr 1fr',
              alignItems: 'center',
              padding: '12px 16px',
              borderRadius: 10,
              background: isSelf
                ? 'rgba(58,92,232,0.06)'
                : rankMeta ? rankMeta.bg : '#fff',
              border: isSelf
                ? '1px solid rgba(58,92,232,0.15)'
                : '1px solid #F0EFFF',
              borderLeft: isSelf ? '3px solid #3A5CE8' : undefined,
              transition: 'background 0.1s',
            }}>
              {/* Rank */}
              <div style={{
                fontFamily: 'DM Mono, monospace',
                fontSize: rank <= 3 ? 16 : 13,
                fontWeight: 700,
                color: rankMeta?.color ?? '#8A8C9E',
              }}>
                {rankMeta ? rankMeta.label : rank}
              </div>

              {/* Wallet */}
              <div style={{
                fontFamily: 'DM Mono, monospace',
                fontSize: 12, fontWeight: 500,
                color: isSelf ? '#3A5CE8' : '#1A1A2E',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {shortAddr(entry.wallet)}
                {isSelf && (
                  <span style={{
                    marginLeft: 6, fontSize: 10, fontWeight: 700,
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    background: 'rgba(58,92,232,0.1)', color: '#3A5CE8',
                    borderRadius: 4, padding: '1px 5px',
                  }}>you</span>
                )}
              </div>

              {/* Points */}
              <div style={{
                textAlign: 'right',
                fontFamily: 'DM Mono, monospace',
                fontSize: 13, fontWeight: 600,
                color: isSelf ? '#3A5CE8' : '#1A1A2E',
              }}>
                {pts.toLocaleString()}
              </div>

              {/* Earned */}
              <div style={{
                textAlign: 'right',
                fontFamily: 'DM Mono, monospace',
                fontSize: 12, color: '#2A9E8A', fontWeight: 500,
              }}>
                {earned != null ? fmtUSD(Number(earned)) : '—'}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

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
      <div className="text-center py-12 px-5 font-sans text-[13px] text-mw-ink-4">
        Loading leaderboard…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 bg-[rgba(194,83,122,0.05)] border border-[rgba(194,83,122,0.15)] rounded-md font-sans text-[13px] text-mw-pink">
        {error}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-14 px-5 bg-white border border-[#E0DFFF] rounded-lg">
        <div className="text-[32px] mb-3">🏆</div>
        <div className="font-sans text-[15px] font-semibold text-[#1A1A2E] mb-[6px]">
          No participants yet
        </div>
        <div className="font-sans text-[13px] text-mw-ink-4">
          Be the first to join and top the board.
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Header row */}
      <div className="grid grid-cols-[44px_1fr_1fr_1fr] px-4 pb-[10px] pt-[6px] font-sans text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-4">
        <span>#</span>
        <span>Wallet</span>
        <span className="text-right">Points</span>
        <span className="text-right">Earned</span>
      </div>

      <div className="flex flex-col gap-1">
        {entries.map((entry, idx) => {
          const rank    = idx + 1
          const rankMeta = RANK_COLORS[rank]
          const isSelf  = walletAddress && entry.wallet?.toLowerCase() === walletAddress.toLowerCase()
          const pts     = entry.total_points ?? entry.points ?? 0
          const earned  = entry.total_earned_usd ?? entry.earned_usd

          return (
            <div
              key={entry.wallet ?? idx}
              className="grid grid-cols-[44px_1fr_1fr_1fr] items-center px-4 py-3 rounded-[10px] transition-colors duration-100"
              style={{
                background: isSelf
                  ? 'rgba(58,92,232,0.06)'
                  : rankMeta ? rankMeta.bg : '#fff',
                border: isSelf
                  ? '1px solid rgba(58,92,232,0.15)'
                  : '1px solid #F0EFFF',
                borderLeft: isSelf ? '3px solid #3A5CE8' : undefined,
              }}
            >
              {/* Rank */}
              <div
                className={`font-mono font-bold ${rank <= 3 ? 'text-[16px]' : 'text-[13px]'}`}
                style={{ color: rankMeta?.color ?? '#8A8C9E' }}
              >
                {rankMeta ? rankMeta.label : rank}
              </div>

              {/* Wallet */}
              <div className={`font-mono text-[12px] font-medium overflow-hidden text-ellipsis whitespace-nowrap ${isSelf ? 'text-mw-brand-deep' : 'text-[#1A1A2E]'}`}>
                {shortAddr(entry.wallet)}
                {isSelf && (
                  <span className="ml-[6px] text-[10px] font-bold font-sans bg-[rgba(58,92,232,0.1)] text-mw-brand-deep rounded-[4px] px-[5px] py-[1px]">you</span>
                )}
              </div>

              {/* Points */}
              <div className={`text-right font-mono text-[13px] font-semibold ${isSelf ? 'text-mw-brand-deep' : 'text-[#1A1A2E]'}`}>
                {pts.toLocaleString()}
              </div>

              {/* Earned */}
              <div className="text-right font-mono text-[12px] text-mw-teal font-medium">
                {earned != null ? fmtUSD(Number(earned)) : '—'}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

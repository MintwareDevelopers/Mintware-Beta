'use client'

// =============================================================================
// Leaderboard.tsx — Campaign leaderboard tab
//
// Fetches GET /leaderboard?campaign_id= on mount.
// Ranked list: rank | wallet | points | earned USD
// Top 3: coral / ink / clay rank colors
// Current wallet row: atx-blue accent + left border
// Design: ATX Settlemint — square, hairline rules, mono data.
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

const RANK_COLORS: Record<number, string> = {
  1: 'text-atx-coral',
  2: 'text-atx-ink/60',
  3: 'text-atx-clay',
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
      <div className="text-center py-12 px-5 font-atx-display text-[13px] text-atx-ink/55">
        Loading leaderboard…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-5 bg-atx-bone border border-atx-clay font-atx-display text-[13px] text-atx-clay">
        {error}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-14 px-5 bg-atx-panel border border-atx-ink/20">
        <svg viewBox="0 0 100 100" className="w-8 h-8 text-atx-coral mx-auto mb-3" aria-hidden="true">
          <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
        </svg>
        <div className="font-atx-display text-[15px] font-semibold text-atx-ink mb-[6px]">
          No participants yet
        </div>
        <div className="font-atx-display text-[13px] text-atx-ink/55">
          Be the first to join and top the board.
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Header row */}
      <div className="grid grid-cols-[44px_1fr_1fr_1fr] px-4 pb-[10px] pt-[6px] font-atx-mono text-[10px] font-bold tracking-[0.1em] uppercase text-atx-ink/55">
        <span>#</span>
        <span>Wallet</span>
        <span className="text-right">Points</span>
        <span className="text-right">Earned</span>
      </div>

      <div className="flex flex-col gap-1">
        {entries.map((entry, idx) => {
          const rank    = idx + 1
          const rankColor = RANK_COLORS[rank]
          const isSelf  = walletAddress && entry.wallet?.toLowerCase() === walletAddress.toLowerCase()
          const pts     = entry.total_points ?? entry.points ?? 0
          const earned  = entry.total_earned_usd ?? entry.earned_usd

          return (
            <div
              key={entry.wallet ?? idx}
              className={`grid grid-cols-[44px_1fr_1fr_1fr] items-center px-4 py-3 border transition-colors duration-100 ${isSelf ? 'bg-atx-bone border-atx-ink border-l-[3px] border-l-atx-blue' : 'bg-atx-panel border-atx-ink/20'}`}
            >
              {/* Rank */}
              <div className={`font-atx-mono font-bold ${rank <= 3 ? 'text-[16px]' : 'text-[13px]'} ${rankColor ?? 'text-atx-ink/45'}`}>
                {rank}
              </div>

              {/* Wallet */}
              <div className={`font-atx-mono text-[12px] font-medium overflow-hidden text-ellipsis whitespace-nowrap ${isSelf ? 'text-atx-blue' : 'text-atx-ink'}`}>
                {shortAddr(entry.wallet)}
                {isSelf && (
                  <span className="ml-[6px] text-[10px] font-bold font-atx-mono uppercase tracking-[0.06em] bg-atx-bone border border-atx-ink/25 text-atx-blue px-[5px] py-[1px]">you</span>
                )}
              </div>

              {/* Points */}
              <div className={`text-right font-atx-mono text-[13px] font-semibold ${isSelf ? 'text-atx-blue' : 'text-atx-ink'}`}>
                {pts.toLocaleString()}
              </div>

              {/* Earned */}
              <div className="text-right font-atx-mono text-[12px] text-atx-mesquite font-medium">
                {earned != null ? fmtUSD(Number(earned)) : '—'}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

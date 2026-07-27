'use client'

// =============================================================================
// JoinButton.tsx — Join campaign CTA with score gating
//
// States:
//   • not-connected  — "Connect wallet to join"
//   • locked         — score < min_score: show score vs required
//   • idle           — ready to join: [Join Campaign]
//   • loading        — POST /join in flight
//   • joined         — already a participant: show joined state
//   • error          — POST failed
//
// Design: ATX Settlemint — square, hairline borders, flat atx-blue primary.
// =============================================================================

import { useState } from 'react'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'

interface JoinButtonProps {
  campaignId: string
  minScore: number
  userScore: number | null    // null = not yet loaded
  isJoined: boolean
  wallet: string | undefined  // undefined = not connected
  onJoined: () => void        // refetch parent data on success
}

export function JoinButton({ campaignId, minScore, userScore, isJoined, wallet, onJoined }: JoinButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleJoin() {
    if (!wallet) return
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/campaigns/join', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ campaign_id: campaignId, address: wallet }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Join failed')
      toast.success('Joined campaign!', { description: 'You\'re now participating. Start earning points.' })
      onJoined()
    } catch (err) {
      const msg = (err as Error).message ?? 'Something went wrong'
      setError(msg)
      toast.error('Could not join', { description: msg })
    } finally {
      setLoading(false)
    }
  }

  // ── Joined ──────────────────────────────────────────────────────────────
  if (isJoined) {
    return (
      <div className="inline-flex items-center gap-2 bg-atx-panel border border-atx-ink px-5 py-[10px] font-atx-display text-[14px] font-semibold text-atx-mesquite">
        <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block" /> Joined
      </div>
    )
  }

  // ── Not connected ────────────────────────────────────────────────────────
  if (!wallet) {
    return (
      <div className="bg-atx-bone border border-atx-ink/20 px-6 py-[14px] text-atx-ink/45 cursor-not-allowed font-atx-display text-[14px] font-semibold text-center">
        Connect wallet to join
      </div>
    )
  }

  // ── Score loading ────────────────────────────────────────────────────────
  if (userScore === null) {
    return (
      <div className="bg-atx-bone border border-atx-ink/20 px-6 py-[14px] text-atx-ink/45 font-atx-display text-[14px] font-semibold text-center">
        Checking score…
      </div>
    )
  }

  // ── Locked: score too low ────────────────────────────────────────────────
  if (minScore > 0 && userScore < minScore) {
    return (
      <div className="bg-atx-bone border border-atx-ink/25 px-5 py-[14px] cursor-not-allowed font-atx-display">
        <div className="flex items-center gap-2 mb-[6px]">
          <Lock size={14} className="text-atx-ink/45 shrink-0" />
          <span className="text-[14px] font-bold text-atx-ink/55">
            Score {minScore}+ required
          </span>
        </div>
        <div className="text-[12px] text-atx-ink/45 leading-[1.5]">
          Your score:{' '}
          <span className="font-atx-mono font-semibold text-atx-coral">
            {userScore}
          </span>
          {' '}·{' '}
          Need:{' '}
          <span className="font-atx-mono font-semibold text-atx-blue">
            {minScore}
          </span>
        </div>
        <div className="text-[11px] text-atx-ink/45 mt-[6px]">
          Improve your score to unlock this campaign
        </div>
      </div>
    )
  }

  // ── Ready / loading / error ──────────────────────────────────────────────
  return (
    <div>
      <button
        onClick={handleJoin}
        disabled={loading}
        className={`w-full border border-atx-ink px-6 py-[14px] font-atx-display text-[15px] font-semibold text-white transition-colors duration-150 ${loading ? 'bg-atx-blue/60 cursor-not-allowed' : 'bg-atx-blue cursor-pointer hover:bg-atx-ink'}`}
      >
        {loading ? 'Joining…' : 'Join Campaign'}
      </button>

      {error && (
        <div className="mt-2 text-[12px] text-atx-clay bg-atx-bone border border-atx-ink/20 px-[10px] py-2 font-atx-display">
          {error}
        </div>
      )}
    </div>
  )
}

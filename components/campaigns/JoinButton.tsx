'use client'

// =============================================================================
// JoinButton.tsx — Join campaign CTA with score gating
//
// States:
//   • not-connected  — "Connect wallet to join"
//   • locked         — score < min_score: show score vs required
//   • idle           — ready to join: [Join Campaign]
//   • loading        — POST /join in flight
//   • joined         — already a participant: show green joined state
//   • error          — POST failed
//
// Design: #3A5CE8 primary button, locked uses #F7F6FF bg + muted text.
// =============================================================================

import { useState } from 'react'
import { API } from '@/lib/api'

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
      const res  = await fetch(`${API}/join`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ campaign_id: campaignId, address: wallet }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Join failed')
      onJoined()
    } catch (err) {
      setError((err as Error).message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // ── Joined ──────────────────────────────────────────────────────────────
  if (isJoined) {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: 'rgba(42,158,138,0.10)', border: '1px solid rgba(42,158,138,0.2)',
        borderRadius: 10, padding: '10px 20px',
        fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, fontWeight: 600,
        color: '#2A9E8A',
      }}>
        ✓ Joined
      </div>
    )
  }

  // ── Not connected ────────────────────────────────────────────────────────
  if (!wallet) {
    return (
      <div style={{
        background: '#F7F6FF', border: '1px solid #E0DFFF', borderRadius: 10,
        padding: '14px 24px', color: '#8A8C9E', cursor: 'not-allowed',
        fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, fontWeight: 600,
        textAlign: 'center',
      }}>
        Connect wallet to join
      </div>
    )
  }

  // ── Score loading ────────────────────────────────────────────────────────
  if (userScore === null) {
    return (
      <div style={{
        background: '#F7F6FF', border: '1px solid #E0DFFF', borderRadius: 10,
        padding: '14px 24px', color: '#8A8C9E',
        fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, fontWeight: 600,
        textAlign: 'center',
      }}>
        Checking score…
      </div>
    )
  }

  // ── Locked: score too low ────────────────────────────────────────────────
  if (minScore > 0 && userScore < minScore) {
    return (
      <div style={{
        background: '#F7F6FF', border: '1px solid #E0DFFF', borderRadius: 10,
        padding: '14px 20px', cursor: 'not-allowed',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#8A8C9E' }}>
            Score {minScore}+ required
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#8A8C9E', lineHeight: 1.5 }}>
          Your score:{' '}
          <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: '#C2537A' }}>
            {userScore}
          </span>
          {' '}·{' '}
          Need:{' '}
          <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: '#3A5CE8' }}>
            {minScore}
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#8A8C9E', marginTop: 6 }}>
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
        style={{
          width: '100%',
          background: loading ? '#C4C3F0' : '#3A5CE8',
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          padding: '14px 24px',
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 15,
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s, box-shadow 0.15s, transform 0.15s',
          boxShadow: loading ? 'none' : '0 2px 12px rgba(58,92,232,0.25)',
        }}
        onMouseEnter={(e) => {
          if (!loading) (e.currentTarget as HTMLButtonElement).style.background = '#2a4cd8'
        }}
        onMouseLeave={(e) => {
          if (!loading) (e.currentTarget as HTMLButtonElement).style.background = '#3A5CE8'
        }}
      >
        {loading ? 'Joining…' : 'Join Campaign'}
      </button>

      {error && (
        <div style={{
          marginTop: 8, fontSize: 12, color: '#C2537A',
          background: 'rgba(194,83,122,0.06)',
          border: '1px solid rgba(194,83,122,0.15)',
          borderRadius: 8, padding: '8px 10px',
          fontFamily: 'Plus Jakarta Sans, sans-serif',
        }}>
          ✗ {error}
        </div>
      )}
    </div>
  )
}

'use client'

// =============================================================================
// JoinButton.tsx — Campaign join button
//
// States:
//   not-connected  → greyed out (no wallet)
//   joining        → spinner
//   error          → inline error, retry
//
// No score gating — all wallets join as full participants.
// Inline styles only — no Tailwind.
// =============================================================================

import { useState } from 'react'
import { API } from '@/lib/api'

interface JoinButtonProps {
  campaignId: string
  wallet:     string | undefined
  onJoined:   () => void
}

type JoinState = 'idle' | 'joining' | 'error'

export function JoinButton({ campaignId, wallet, onJoined }: JoinButtonProps) {
  const [joinState, setJoinState] = useState<JoinState>('idle')
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null)

  if (!wallet) {
    return (
      <button disabled style={disabledStyle}>
        Connect wallet to join
      </button>
    )
  }

  async function handleJoin() {
    if (!wallet || joinState === 'joining') return
    setJoinState('joining')
    setErrorMsg(null)

    try {
      const referrer = (typeof sessionStorage !== 'undefined')
        ? (sessionStorage.getItem('mw_referrer') || null)
        : null

      const body: Record<string, unknown> = {
        wallet,
        campaign_id: campaignId,
        ...(referrer && { referred_by: referrer }),
      }

      const res  = await fetch(`${API}/join`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()

      if (data.error && !data.error.toLowerCase().includes('already')) {
        throw new Error(data.error)
      }

      onJoined()
    } catch {
      setErrorMsg('Unable to join — please try again or contact support')
      setJoinState('error')
    }
  }

  const isJoining = joinState === 'joining'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        onClick={handleJoin}
        disabled={isJoining}
        style={{
          ...primaryBtnStyle,
          cursor:  isJoining ? 'not-allowed' : 'pointer',
          opacity: isJoining ? 0.7 : 1,
        }}
      >
        {isJoining
          ? <><Spinner /> Joining…</>
          : 'Join campaign →'
        }
      </button>

      {errorMsg && (
        <div style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 12, color: '#C2537A', textAlign: 'center',
        }}>
          {errorMsg}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const baseBtn: React.CSSProperties = {
  display:        'inline-flex',
  alignItems:     'center',
  justifyContent: 'center',
  gap:            6,
  padding:        '10px 22px',
  borderRadius:   10,
  border:         'none',
  fontFamily:     'Plus Jakarta Sans, sans-serif',
  fontSize:       13,
  fontWeight:     600,
  whiteSpace:     'nowrap',
  transition:     'background 150ms, opacity 150ms',
}

const primaryBtnStyle: React.CSSProperties = {
  ...baseBtn,
  background: '#3A5CE8',
  color:      '#fff',
}

const disabledStyle: React.CSSProperties = {
  ...baseBtn,
  background: '#F0EFFF',
  color:      '#C4C3F0',
  cursor:     'not-allowed',
}

function Spinner() {
  return (
    <>
      <style>{`
        @keyframes jb-spin { to { transform: rotate(360deg); } }
      `}</style>
      <span style={{
        width: 12, height: 12, borderRadius: '50%',
        border: '2px solid rgba(0,0,0,0.15)',
        borderTopColor: 'currentColor',
        display: 'inline-block',
        animation: 'jb-spin 0.6s linear infinite',
        flexShrink: 0,
      }} />
    </>
  )
}

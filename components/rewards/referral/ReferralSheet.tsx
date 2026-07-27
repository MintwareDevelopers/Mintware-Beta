'use client'

import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { RefCodeInput } from './RefCodeInput'
import type { ReferralStats } from '@/lib/rewards/referral/types'

interface ReferralSheetProps {
  stats:    ReferralStats | null
  trigger:  boolean   // isFirstConnect && scoreLoaded
}

const DISMISSED_KEY = 'mw_ref_sheet_dismissed'

export function ReferralSheet({ stats, trigger }: ReferralSheetProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!trigger || !stats) return
    if (typeof window !== 'undefined' && sessionStorage.getItem(DISMISSED_KEY)) return

    const t = setTimeout(() => setOpen(true), 1500)
    return () => clearTimeout(t)
  }, [trigger, stats])

  function dismiss() {
    setOpen(false)
    sessionStorage.setItem(DISMISSED_KEY, 'true')
  }

  if (!stats) return null

  const pct = Math.round((stats.sharing_score / 125) * 100)

  return (
    <Drawer.Root open={open} onOpenChange={(v) => { if (!v) dismiss() }} shouldScaleBackground>
      <Drawer.Portal>
        <Drawer.Overlay
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.32)',
            zIndex: 999,
          }}
        />
        <Drawer.Content
          style={{
            position: 'fixed',
            bottom: 0, left: 0, right: 0,
            background: 'var(--color-atx-panel)',
            borderRadius: 0,
            border: '1px solid var(--color-atx-ink)',
            borderBottom: 'none',
            zIndex: 1000,
            padding: '28px 24px 40px',
            maxWidth: 520,
            margin: '0 auto',
            fontFamily: 'var(--font-space-grotesk), sans-serif',
            outline: 'none',
          }}
        >
          {/* Drag handle */}
          <div style={{
            width: 36, height: 4,
            background: 'var(--color-atx-ink)',
            opacity: 0.2,
            borderRadius: 0,
            margin: '0 auto 22px',
          }} />

          <Drawer.Title style={{
            fontSize: 18, fontWeight: 700,
            color: 'var(--color-atx-ink)',
            marginBottom: 6,
            textAlign: 'center',
            fontFamily: 'var(--font-space-grotesk), sans-serif',
          }}>
            Your Mintware profile is live.
          </Drawer.Title>

          <Drawer.Description style={{
            fontSize: 13,
            color: 'rgba(17,17,17,0.55)',
            textAlign: 'center',
            marginBottom: 20,
            fontFamily: 'var(--font-space-grotesk), sans-serif',
          }}>
            Share your link to grow your Sharing score.
          </Drawer.Description>

          {/* Score badge */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            background: 'var(--color-atx-bone)',
            border: '1px solid var(--color-atx-ink)',
            borderRadius: 0, padding: '14px 20px', marginBottom: 20,
          }}>
            <div>
              <div style={{ fontSize: 10, color: 'rgba(17,17,17,0.55)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-jetbrains), monospace' }}>Sharing score</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-atx-coral)', fontFamily: 'var(--font-jetbrains), monospace', lineHeight: 1 }}>
                {stats.sharing_score}<span style={{ fontSize: 14, opacity: 0.5 }}>/125</span>
              </div>
            </div>
            <div style={{ flex: 1, height: 8, background: 'transparent', border: '1px solid var(--color-atx-ink)', borderRadius: 0, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                height: '100%', background: 'var(--color-atx-coral)', borderRadius: 0,
                width: pct + '%', transition: 'width 0.6s ease',
              }} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <RefCodeInput value={stats.ref_link} buttonLabel="Copy Link" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <RefCodeInput value={stats.ref_code} buttonLabel="Copy Code" ghost />
          </div>

          <button
            onClick={dismiss}
            style={{
              width: '100%', padding: 10, background: 'transparent',
              color: 'rgba(17,17,17,0.55)', border: 'none',
              fontSize: 12, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
              fontFamily: 'var(--font-jetbrains), monospace',
            }}
          >
            Maybe Later
          </button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

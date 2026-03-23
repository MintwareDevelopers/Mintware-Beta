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
            background: '#fff',
            borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
            boxShadow: 'var(--shadow-sheet)',
            zIndex: 1000,
            padding: '28px 24px 40px',
            maxWidth: 520,
            margin: '0 auto',
            fontFamily: 'var(--font-jakarta, "Plus Jakarta Sans", sans-serif)',
            outline: 'none',
          }}
        >
          {/* Drag handle */}
          <div style={{
            width: 36, height: 4,
            background: 'var(--color-mw-border)',
            borderRadius: 2,
            margin: '0 auto 22px',
          }} />

          <Drawer.Title style={{
            fontSize: 18, fontWeight: 700,
            color: 'var(--color-mw-ink)',
            marginBottom: 6,
            textAlign: 'center',
            fontFamily: 'var(--font-jakarta, "Plus Jakarta Sans", sans-serif)',
          }}>
            Your Mintware profile is live.
          </Drawer.Title>

          <Drawer.Description style={{
            fontSize: 13,
            color: 'var(--color-mw-ink-4)',
            textAlign: 'center',
            marginBottom: 20,
            fontFamily: 'var(--font-jakarta, "Plus Jakarta Sans", sans-serif)',
          }}>
            Share your link to grow your Sharing score.
          </Drawer.Description>

          {/* Score badge */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            background: 'var(--color-mw-surface-purple)',
            border: '1.5px solid rgba(194,83,122,0.2)',
            borderRadius: 14, padding: '14px 20px', marginBottom: 20,
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Sharing score</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-mw-pink)', fontFamily: 'var(--font-mono, "DM Mono", monospace)', lineHeight: 1 }}>
                {stats.sharing_score}<span style={{ fontSize: 14, opacity: 0.5 }}>/125</span>
              </div>
            </div>
            <div style={{ flex: 1, height: 6, background: 'rgba(194,83,122,0.12)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: 'var(--color-mw-pink)', borderRadius: 3,
                width: pct + '%', transition: 'width 0.6s var(--easing-spring)',
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
              color: 'var(--color-mw-ink-4)', border: 'none',
              fontSize: 13, cursor: 'pointer',
              fontFamily: 'var(--font-jakarta, "Plus Jakarta Sans", sans-serif)',
            }}
          >
            Maybe Later
          </button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

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
            borderRadius: 'var(--radius-panel) var(--radius-panel) 0 0',
            border: '1px solid var(--color-hair)',
            borderBottom: 'none',
            boxShadow: 'var(--shadow-lift)',
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
            width: 40, height: 4,
            background: 'var(--color-hair)',
            borderRadius: 999,
            margin: '0 auto 22px',
          }} />

          <Drawer.Title style={{
            fontSize: 18, fontWeight: 500,
            color: 'var(--color-ink)',
            letterSpacing: '-0.02em',
            marginBottom: 6,
            textAlign: 'center',
            fontFamily: 'var(--font-space-grotesk), sans-serif',
          }}>
            Your Mintware profile is live.
          </Drawer.Title>

          <Drawer.Description style={{
            fontSize: 13,
            color: 'var(--color-ink-mid)',
            textAlign: 'center',
            marginBottom: 20,
            fontFamily: 'var(--font-space-grotesk), sans-serif',
          }}>
            Share your link to grow your Sharing score.
          </Drawer.Description>

          {/* Score badge */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            background: 'var(--color-ground-cool)',
            border: '1px solid var(--color-hair)',
            borderRadius: 16, padding: '14px 20px', marginBottom: 20,
          }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--color-ink-soft)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Sharing score</div>
              <div style={{ fontSize: 28, fontWeight: 500, color: 'var(--color-coral2-deep)', fontFamily: 'var(--font-space-grotesk), sans-serif', lineHeight: 1 }}>
                {stats.sharing_score}<span style={{ fontSize: 14, opacity: 0.5 }}>/125</span>
              </div>
            </div>
            <div style={{ flex: 1, height: 8, background: '#fff', border: '1px solid var(--color-hair)', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                height: '100%', background: 'var(--color-coral2)', borderRadius: 999,
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
              color: 'var(--color-ink-soft)', border: 'none',
              fontSize: 12, cursor: 'pointer', fontWeight: 500,
              fontFamily: 'var(--font-space-grotesk), sans-serif',
            }}
          >
            Maybe Later
          </button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

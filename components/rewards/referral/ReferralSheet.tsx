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
        <Drawer.Overlay className="fixed inset-0 z-[999]" style={{ background: 'rgba(21,21,29,.32)' }} />
        <Drawer.Content
          className="mw-raise-lg font-geist fixed bottom-0 left-0 right-0 z-[1000] mx-auto max-w-[520px] rounded-t-[26px] px-6 pt-5 pb-10 outline-none overflow-hidden"
        >
          <div aria-hidden="true" className="absolute -right-24 -top-28 w-72 h-72 rounded-full opacity-25 blur-[56px]" style={{ background: 'var(--mw-sheen)' }} />
          {/* Drag handle */}
          <div className="relative w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} />

          <Drawer.Title className="relative text-[20px] font-semibold tracking-[-0.03em] text-center mb-1.5">
            Your Mintware profile is live.
          </Drawer.Title>

          <Drawer.Description className="relative text-[14px] text-ink-mid text-center mb-5">
            Share your link to grow your Sharing score.
          </Drawer.Description>

          {/* Score gauge */}
          <div className="relative flex items-center gap-4 rounded-[16px] px-5 py-4 mb-5" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Sharing score</div>
              <div className="font-geist-mono text-[28px] leading-none mt-1 tracking-[-0.03em]">
                {stats.sharing_score}<span className="text-[14px] text-ink-soft">/125</span>
              </div>
            </div>
            <div className="flex-1 h-3 rounded-full overflow-hidden bg-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(21,21,29,.06)' }}>
              <div className="h-full rounded-full transition-[width] duration-[600ms] ease-out" style={{ width: pct + '%', background: '#7C7AF0' }} />
            </div>
          </div>

          <div className="relative mb-3">
            <RefCodeInput value={stats.ref_link} buttonLabel="Copy Link" />
          </div>
          <div className="relative mb-4">
            <RefCodeInput value={stats.ref_code} buttonLabel="Copy Code" ghost />
          </div>

          <button
            onClick={dismiss}
            className="relative w-full min-h-[44px] bg-transparent border-0 text-ink-mid text-[14px] font-medium cursor-pointer hover:text-ink"
          >
            Maybe later
          </button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

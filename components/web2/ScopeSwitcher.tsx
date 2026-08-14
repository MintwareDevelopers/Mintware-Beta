'use client'

// ScopeSwitcher — the top-left context switcher (Personal ⟷ Team), the convention
// across Vercel/Linear/Notion/Stripe/Safe. Re-scopes the same app shell rather than
// routing to a separate app. Phase 1: two fixed contexts + a "Create organization"
// footer stub (Phase 2 wires real orgs via Privy metadata).

import { useState, useRef, useEffect } from 'react'
import { useAppMode, type AppMode } from './AppMode'

const CONTEXTS: { mode: AppMode; label: string; sub: string; tone: string }[] = [
  { mode: 'user', label: 'Personal', sub: 'Retail LP', tone: 'var(--color-peri)' },
  { mode: 'team', label: 'Treasury', sub: 'Team', tone: 'var(--color-coral2)' },
]

export function ScopeSwitcher() {
  const { mode, switchTo } = useAppMode()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = CONTEXTS.find((c) => c.mode === mode) ?? CONTEXTS[0]

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-hair bg-white pl-2.5 pr-2 py-1.5 text-left hover:border-[rgba(108,108,240,0.35)] transition-colors cursor-pointer max-w-[190px]"
      >
        <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: cur.tone }} />
        <span className="min-w-0 leading-tight">
          <span className="block text-[12.5px] font-semibold text-ink truncate">{cur.label}</span>
          <span className="block text-[9px] uppercase tracking-[0.1em] text-ink-soft truncate">{cur.sub}</span>
        </span>
        <span className="text-ink-soft text-[10px] shrink-0">▾</span>
      </button>

      {open && (
        <div role="menu" className="absolute left-0 top-[calc(100%+6px)] z-[250] w-[220px] rounded-2xl border border-hair bg-white shadow-lift overflow-hidden">
          <div className="px-3 pt-2.5 pb-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Switch context</div>
          {CONTEXTS.map((c) => {
            const active = c.mode === mode
            return (
              <button
                key={c.mode}
                role="menuitem"
                onClick={() => { if (!active) switchTo(c.mode); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${active ? 'bg-ground-cool' : 'hover:bg-ground-cool'}`}
              >
                <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: c.tone }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink">{c.label}</span>
                  <span className="block text-[10px] text-ink-soft">{c.sub}</span>
                </span>
                {active && <span className="text-peri text-[12px] shrink-0">✓</span>}
              </button>
            )
          })}
          <button
            role="menuitem"
            disabled
            title="Coming soon"
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-t border-hair-soft text-ink-soft cursor-not-allowed"
          >
            <span className="w-[18px] h-[18px] rounded-md border border-hair grid place-items-center text-[12px] shrink-0">+</span>
            <span className="text-[12.5px]">Create organization<span className="block text-[9px] uppercase tracking-[0.1em]">Coming soon</span></span>
          </button>
        </div>
      )}
    </div>
  )
}

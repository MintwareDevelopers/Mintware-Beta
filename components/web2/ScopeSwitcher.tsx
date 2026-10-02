'use client'

// WorkspaceSwitcher (exported as ScopeSwitcher for existing callers) — the top-of-sidebar switcher, the
// Linear / Vercel / Safe convention. Personal ⟷ Team ⟷ RWA all live in the SAME AppShell; picking one
// swaps the sidebar menu and routes to that workspace's home, never to a different-looking app.

import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import { useAppMode, type AppMode } from './AppMode'
import { useActiveOrg } from './useActiveOrg'

const RWA_ON = process.env.NEXT_PUBLIC_V2_RWA_ENABLED === 'true'

type Ws = { mode: AppMode; label: string; sub: string; glyph: string; tile: string; ink: string }

function useWorkspaces(): Ws[] {
  const { active } = useActiveOrg()
  const list: Ws[] = [
    { mode: 'user', label: 'Personal', sub: 'Your account', glyph: 'P', tile: 'rgba(108,108,240,0.14)', ink: 'var(--color-peri-deep)' },
    { mode: 'team', label: active?.name ?? 'Team', sub: active ? 'Treasury' : 'Treasury · preview', glyph: (active?.name ?? 'T').slice(0, 1).toUpperCase(), tile: 'rgba(232,138,103,0.16)', ink: '#B4532A' },
  ]
  if (RWA_ON) list.push({ mode: 'rwa', label: 'RWA', sub: 'Real-world assets', glyph: 'R', tile: 'rgba(42,158,138,0.15)', ink: 'var(--color-mw-teal)' })
  return list
}

function Tile({ ws, size = 28 }: { ws: Ws; size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-[8px] font-semibold shrink-0"
      style={{ width: size, height: size, background: ws.tile, color: ws.ink, fontSize: size * 0.46 }}
      aria-hidden
    >
      {ws.glyph}
    </span>
  )
}

export function ScopeSwitcher({ compact = false }: { compact?: boolean }) {
  const { mode, switchTo } = useAppMode()
  const workspaces = useWorkspaces()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = workspaces.find((w) => w.mode === mode) ?? workspaces[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-ground-cool transition-colors cursor-pointer"
      >
        <Tile ws={cur} size={compact ? 26 : 30} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[13.5px] font-semibold text-ink truncate">{cur.label}</span>
          {!compact && <span className="block text-[11px] text-ink-soft truncate">{cur.sub}</span>}
        </span>
        <span className="text-ink-soft text-[11px] shrink-0">⌄</span>
      </button>

      {open && (
        <div role="menu" className="absolute left-0 top-[calc(100%+6px)] z-[250] w-[260px] rounded-2xl border border-hair bg-white shadow-lift overflow-hidden">
          <div className="px-3.5 pt-3 pb-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Workspaces</div>
          {workspaces.map((w) => {
            const active = w.mode === mode
            return (
              <button
                key={w.mode}
                role="menuitem"
                onClick={() => { setOpen(false); if (!active) switchTo(w.mode) }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${active ? 'bg-ground-cool' : 'hover:bg-ground-cool'}`}
              >
                <Tile ws={w} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-ink truncate">{w.label}</span>
                  <span className="block text-[11px] text-ink-soft truncate">{w.sub}</span>
                </span>
                {active && <span className="text-peri text-[13px] shrink-0">✓</span>}
              </button>
            )
          })}
          <Link
            href="/app/org/new"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 border-t border-hair-soft text-ink-mid no-underline hover:bg-ground-cool hover:text-ink"
          >
            <span className="grid place-items-center w-[30px] h-[30px] rounded-[8px] border border-dashed border-hair text-[15px] shrink-0">+</span>
            <span className="text-[13px] font-medium">Create organization</span>
          </Link>
        </div>
      )}
    </div>
  )
}

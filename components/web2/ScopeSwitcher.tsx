'use client'

// WorkspaceSwitcher (exported as ScopeSwitcher for existing callers) — the top-of-sidebar switcher, the
// Linear / Vercel / Safe convention. Personal ⟷ Team both live in the SAME AppShell; picking one
// swaps the sidebar menu and routes to that workspace's home, never to a different-looking app.

import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import { useAppMode, type AppMode } from './AppMode'
import { useActiveOrg } from './useActiveOrg'

type Ws = { mode: AppMode; label: string; sub: string; glyph: string; tile: string; ink: string }

function useWorkspaces(): Ws[] {
  const { active } = useActiveOrg()
  const list: Ws[] = [
    { mode: 'user', label: 'Personal', sub: 'Markets and portfolio', glyph: 'P', tile: 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', ink: '#2E2BA8' },
    { mode: 'team', label: active?.name ?? 'Team', sub: active ? 'Treasury' : 'Treasury · preview', glyph: (active?.name ?? 'T').slice(0, 1).toUpperCase(), tile: 'linear-gradient(160deg,#FDE3D7,#F2B79C)', ink: '#8A3A17' },
  ]
  return list
}

function Tile({ ws, size = 28 }: { ws: Ws; size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-[10px] font-semibold shrink-0"
      style={{ width: size, height: size, background: ws.tile, color: ws.ink, fontSize: size * 0.44, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.75)' }}
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
        className="mw-raise-sm w-full flex items-center gap-2.5 rounded-[14px] px-2 py-1.5 text-left border-0 cursor-pointer"
      >
        <Tile ws={cur} size={compact ? 26 : 30} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[13.5px] font-semibold text-ink truncate">{cur.label}</span>
          {!compact && <span className="block text-[11.5px] text-ink-soft truncate">{cur.sub}</span>}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-ink-soft shrink-0"><path d="m7 9 5-5 5 5M7 15l5 5 5-5" /></svg>
      </button>

      {open && (
        <div role="menu" className="mw-raise-lg absolute left-0 top-[calc(100%+8px)] z-[250] w-[270px] rounded-[18px] p-1.5">
          <div className="px-2.5 pt-2 pb-1.5 text-[11px] uppercase tracking-[0.08em] font-semibold text-ink-soft">Workspaces</div>
          {workspaces.map((w) => {
            const active = w.mode === mode
            return (
              <button
                key={w.mode}
                role="menuitem"
                onClick={() => { setOpen(false); if (!active) switchTo(w.mode) }}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-[12px] border-0 text-left transition-colors cursor-pointer ${active ? 'bg-ground-cool' : 'bg-transparent hover:bg-ground-cool'}`}
              >
                <Tile ws={w} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-ink truncate">{w.label}</span>
                  <span className="block text-[11px] text-ink-soft truncate">{w.sub}</span>
                </span>
                {active && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mw-peri-deep)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0"><path d="m5 12 4 4 10-10" /></svg>}
              </button>
            )
          })}
          <Link
            href="/app/org/new"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 w-full flex items-center gap-3 px-2.5 py-2 rounded-[12px] text-ink-mid no-underline hover:bg-ground-cool hover:text-ink"
            style={{ borderTop: '1px solid var(--mw-line)' }}
          >
            <span className="grid place-items-center w-[30px] h-[30px] rounded-[10px] text-[16px] shrink-0" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>+</span>
            <span className="text-[13px] font-medium">Create organization</span>
          </Link>
        </div>
      )}
    </div>
  )
}

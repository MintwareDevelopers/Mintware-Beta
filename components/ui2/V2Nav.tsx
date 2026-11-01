'use client'

// V2Nav — the one public header for every marketing page, the landing included (2026-10-31: the landing's own
// MineralNav and the app-style MwNav on /proof, /legal and the agent pages were retired so every public page
// shows the same links). Mineral styling: frosted porcelain bar, the three-disc mark, quiet links with a raised
// pill on the current one, one solid primary action. Collapses to a menu button below 960px, where six links no
// longer fit beside the logo and the button.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { MineralMark } from '@/components/ui2/MineralMark'

const LINKS = [
  { key: 'markets', href: '/markets', label: 'Markets' },
  { key: 'rwas', href: '/rwas', label: 'RWAs' },
  { key: 'issuers', href: '/issuers', label: 'Issuers' },
  { key: 'cards', href: '/cards', label: 'Card' },
  { key: 'agents', href: '/agents', label: 'Agents' },
  { key: 'docs', href: '/docs', label: 'Docs' },
] as const

export type V2NavActive = (typeof LINKS)[number]['key']

/** The link for the current page: its own path or anything under it (/agents/leaderboard → Agents). */
function activeFor(pathname: string): V2NavActive | undefined {
  return LINKS.find((l) => pathname === l.href || pathname.startsWith(l.href + '/'))?.key
}

export function V2Nav({ active }: { active?: V2NavActive }) {
  const pathname = usePathname() ?? ''
  const current = active ?? activeFor(pathname)
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header
      className="font-geist sticky top-0 z-50"
      style={{ background: 'rgba(246,246,250,0.82)', backdropFilter: 'saturate(1.4) blur(14px)', WebkitBackdropFilter: 'saturate(1.4) blur(14px)', borderBottom: '1px solid var(--mw-line)' }}
    >
      <div className="mx-auto max-w-[1200px] px-[clamp(16px,4vw,40px)] h-[64px] flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 no-underline shrink-0" style={{ color: 'var(--mw-ink)' }}>
          <MineralMark size={28} />
          <span className="font-semibold text-[18px] tracking-[-0.02em]">Mintware</span>
        </Link>

        <nav aria-label="Primary" className="max-[959px]:hidden flex items-center gap-1 rounded-[14px] p-1" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
          {LINKS.map((f) => {
            const on = current === f.key
            return (
              <Link
                key={f.key}
                href={f.href}
                aria-current={on ? 'page' : undefined}
                className="px-3.5 py-1.5 rounded-[10px] text-[14px] font-medium no-underline transition-colors hover:!text-[var(--mw-ink)]"
                style={on ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { color: 'var(--mw-ink-2)' }}
              >
                {f.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          <span className="max-[480px]:hidden rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: 'var(--mw-band)', color: 'var(--mw-ink-2)' }}>Testnet</span>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Menu'}
            aria-expanded={open}
            aria-controls="site-menu"
            className="min-[960px]:hidden mw-btn-quiet !w-11 !h-11 !min-h-0 !px-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
          <Link href="/app/markets" className="mw-btn !min-h-[40px] text-[14px] whitespace-nowrap">Launch app</Link>
        </div>
      </div>

      {open && (
        <div id="site-menu" className="min-[960px]:hidden px-4 pb-4">
          <nav aria-label="Primary" className="mw-raise rounded-[18px] p-2 flex flex-col">
            {LINKS.map((f) => (
              <Link
                key={f.key}
                href={f.href}
                onClick={() => setOpen(false)}
                aria-current={current === f.key ? 'page' : undefined}
                className="px-4 py-3 rounded-[12px] text-[15px] font-medium no-underline"
                style={current === f.key ? { background: 'var(--mw-band)', color: 'var(--mw-ink)' } : { color: 'var(--mw-ink-2)' }}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  )
}

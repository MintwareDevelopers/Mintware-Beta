'use client'

// V2Nav — the marketing nav for every page except the landing (which has MineralNav). Mineral styling:
// frosted porcelain bar, the three-disc mark, quiet links with a raised pill on the active one, one solid
// primary action. Collapses to a menu button under md.

import Link from 'next/link'
import { useState } from 'react'
import { MineralMark } from '@/components/ui2/MineralMark'

const FEATURES = [
  { key: 'markets', href: '/markets', label: 'Markets' },
  { key: 'rwas', href: '/rwas', label: 'RWAs' },
  { key: 'issuers', href: '/issuers', label: 'Issuers' },
  { key: 'cards', href: '/cards', label: 'Card' },
  { key: 'agents', href: '/agents', label: 'Agents' },
] as const

export type V2NavActive = 'markets' | 'rwas' | 'issuers' | 'cards' | 'agents'

export function V2Nav({ active }: { active?: V2NavActive }) {
  const [open, setOpen] = useState(false)

  return (
    <header
      className="font-geist sticky top-0 z-30"
      style={{ background: 'rgba(246,246,250,0.82)', backdropFilter: 'saturate(1.4) blur(14px)', WebkitBackdropFilter: 'saturate(1.4) blur(14px)', borderBottom: '1px solid var(--mw-line)' }}
    >
      <div className="mx-auto max-w-[1200px] px-[clamp(16px,4vw,40px)] h-[64px] flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 no-underline shrink-0" style={{ color: 'var(--mw-ink)' }}>
          <MineralMark size={28} />
          <span className="font-semibold text-[18px] tracking-[-0.02em]">Mintware</span>
        </Link>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-1 rounded-[14px] p-1" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
          {FEATURES.map((f) => {
            const on = active === f.key
            return (
              <Link
                key={f.key}
                href={f.href}
                aria-current={on ? 'page' : undefined}
                className="px-3.5 py-1.5 rounded-[10px] text-[14px] font-medium no-underline transition-colors"
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
            aria-label="Menu"
            aria-expanded={open}
            className="md:hidden mw-btn-quiet !w-11 !h-11 !min-h-0 !px-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
          <Link href="/v1" className="mw-btn !min-h-[40px] text-[14px]">Launch app</Link>
        </div>
      </div>

      {open && (
        <div className="md:hidden px-4 pb-4">
          <div className="mw-raise rounded-[18px] p-2 flex flex-col">
            {FEATURES.map((f) => (
              <Link
                key={f.key}
                href={f.href}
                onClick={() => setOpen(false)}
                className="px-4 py-3 rounded-[12px] text-[15px] font-medium no-underline"
                style={active === f.key ? { background: 'var(--mw-band)', color: 'var(--mw-ink)' } : { color: 'var(--mw-ink-2)' }}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  )
}

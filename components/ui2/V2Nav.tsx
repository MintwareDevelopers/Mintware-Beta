'use client'

// V2Nav — the Privy-esque v2 marketing nav, reused across all marketing pages
// (it replaced the retired MarketingNav). Translucent, soft, glass-pill CTA,
// grotesque wordmark. CTA goes through the shared launch modal.

import Link from 'next/link'
import { useState } from 'react'
import { useLaunch } from '@/components/web2/LaunchModal'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

const FEATURES = [
  { key: 'vaults', href: '/vaults', label: 'Vaults' },
  { key: 'ypn', href: '/yield-payment-network', label: 'Liquid Sovereign Account' },
  { key: 'attribution', href: '/attribution', label: 'Attribution' },
  { key: 'agents', href: '/agents', label: 'Agents' },
  { key: 'teams', href: '/teams', label: 'For Teams' },
] as const

export type V2NavActive = 'vaults' | 'ypn' | 'attribution' | 'agents' | 'teams' | 'defi'

export function V2Nav({ active }: { active?: V2NavActive }) {
  const { isConnected } = useMintwareIdentity()
  const { launch } = useLaunch()
  const [open, setOpen] = useState(false)
  const launchLabel = isConnected ? 'Go to the app' : 'Launch app'

  return (
    <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-[16px] border-b border-hair-soft">
      <div className="mx-auto max-w-[1220px] px-6 max-[820px]:px-4 h-[62px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 no-underline text-ink shrink-0">
          <span className="w-[22px] h-[22px] rounded-[7px] grid place-items-center text-white text-[12px]" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))', boxShadow: '0 3px 10px rgba(108,108,240,0.35)' }}>✴</span>
          <b className="font-atx-display text-[17px] font-bold tracking-[-0.02em]">Mintware</b>
        </Link>

        <nav className="hidden md:flex items-center gap-7">
          {FEATURES.map((f) => (
            <Link
              key={f.key}
              href={f.href}
              className={`text-[14px] font-medium no-underline transition-colors ${active === f.key ? 'text-ink' : 'text-ink-mid hover:text-ink'}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3.5">
          <Link href="/docs" className="hidden md:inline text-[14px] font-medium text-ink-mid hover:text-ink no-underline">Docs</Link>
          <button onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} className="md:hidden glass-pill glass-pill-sm w-9 h-9 !px-0">{open ? '✕' : '☰'}</button>
          <button onClick={() => launch('/app')} className="glass-pill glass-pill-sm">{launchLabel} →</button>
        </div>
      </div>

      {open && (
        <div className="md:hidden flex flex-col bg-white/95 backdrop-blur-md border-t border-hair-soft">
          {FEATURES.map((f) => (
            <Link key={f.key} href={f.href} onClick={() => setOpen(false)} className={`px-6 py-3.5 text-[15px] font-medium no-underline border-t border-hair-soft ${active === f.key ? 'text-ink' : 'text-ink-mid'}`}>{f.label}</Link>
          ))}
          <Link href="/docs" onClick={() => setOpen(false)} className="px-6 py-3.5 text-[15px] font-medium no-underline border-t border-hair-soft text-ink-mid">Docs</Link>
        </div>
      )}
    </header>
  )
}

'use client'

// =============================================================================
// MarketingNav — shared sticky header for the footer-linked feature pages
// (/attribution, /defi, /rwa). Mirrors the homepage header (ATX Settlemint):
// bone bar, hairline underline, mono nav, one blue "Launch app" CTA.
// =============================================================================

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

const FEATURES = [
  { key: 'vaults', href: '/vaults', label: 'Vaults' },
  { key: 'attribution', href: '/attribution', label: 'Attribution' },
  { key: 'agents', href: '/agents', label: 'Agents' },
  { key: 'teams', href: '/teams', label: 'For Teams' },
] as const

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

export function MarketingNav({ active }: { active?: 'vaults' | 'attribution' | 'agents' | 'teams' | 'defi' }) {
  const { isConnected } = useMintwareIdentity()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()

  function launchApp() {
    if (isConnected) router.push('/app')
    else openConnectModal?.()
  }

  return (
    <header className="sticky top-0 z-20 bg-atx-bone border-b border-atx-ink">
      <div className="mx-auto max-w-[1220px] px-6 h-[56px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 no-underline text-atx-ink">
          <Star className="w-5 h-5 text-atx-blue" />
          <b className="text-[15px] font-bold tracking-[0.06em]">MINTWARE</b>
        </Link>
        <nav className="hidden md:flex gap-6 font-atx-mono text-[11px] uppercase tracking-[0.14em]">
          {FEATURES.map((f) => (
            <Link
              key={f.key}
              href={f.href}
              className={`no-underline ${active === f.key ? 'text-atx-ink' : 'text-atx-ink/55 hover:text-atx-ink'}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={launchApp}
          className="cursor-pointer font-atx-mono text-[11px] uppercase tracking-[0.08em] px-3.5 py-2 border border-atx-blue bg-atx-blue text-white"
        >
          {isConnected ? 'Dashboard →' : 'Launch app →'}
        </button>
      </div>
    </header>
  )
}

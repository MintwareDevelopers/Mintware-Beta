'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MintwareMark } from '@/components/ui2/MintwareMark'

// Shared platform footer. Mounted once in the root layout so it renders on every
// page — EXCEPT the Team treasury terminal, which is a full sidebar app shell with
// its own chrome (a marketing footer there reads wrong).
// Current live app sections only — legacy static mockups (/explorer, /for-protocols.html)
// dropped. Add { href: '/docs', label: 'Docs' } once the docs section ships.
const FOOTER_LINKS = [
  { href: '/attribution', label: 'Attribution' },
  { href: '/defi', label: 'DeFi' },
  { href: '/teams', label: 'For Teams' },
  { href: '/vaults', label: 'Vaults' },
  { href: '/yield-payment-network', label: 'Yield Network' },
  { href: '/app/swap', label: 'Swap' },
  { href: '/agents', label: 'Agents' },
  { href: '/proof', label: 'Proof' },
  { href: '/the-math', label: 'The Math' },
  { href: '/docs', label: 'Docs' },
  { href: '/legal', label: 'Legal' },
  { href: '/about', label: 'About' },
]

const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/risk-disclosures', label: 'Risk Disclosures' },
]

// Solutions — the audience vertical selling pages.
const SOLUTIONS_LINKS = [
  { href: '/solutions/network-states', label: 'Network States' },
  { href: '/solutions/treasuries', label: 'Treasuries' },
  { href: '/solutions/companies', label: 'Companies' },
  { href: '/solutions/funds', label: 'Funds' },
]

export function MwFooter() {
  const pathname = usePathname()
  if (pathname?.startsWith('/app/team')) return null   // treasury terminal has its own shell
  return (
    <footer className="bg-ground-cool border-t border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-9 flex items-center justify-between flex-wrap gap-5">
        <Link href="/" className="flex items-center gap-2.5 no-underline text-ink">
          <MintwareMark size={24} />
          <b className="font-atx-display text-[16px] font-bold tracking-[-0.02em]">Mintware</b>
        </Link>
        <div className="flex gap-x-6 gap-y-1 text-[13px] font-medium flex-wrap">
          {FOOTER_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-ink-mid no-underline hover:text-ink inline-flex items-center min-h-[44px]"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="border-t border-hair-soft">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-4 flex items-center gap-x-6 gap-y-1 flex-wrap text-[13px]">
          <span className="font-atx-display font-semibold text-ink-soft text-[11px] uppercase tracking-[0.1em] mr-1">Solutions</span>
          {SOLUTIONS_LINKS.map((l) => (
            <Link key={l.label} href={l.href} className="text-ink-mid no-underline hover:text-ink font-medium inline-flex items-center min-h-[40px]">
              {l.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="border-t border-hair-soft">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-4 flex items-center justify-between flex-wrap gap-4">
          <div className="text-[12px] text-ink-soft">© 2026 Mintware · Liquidity should be a public good</div>
          <div className="flex gap-x-5 gap-y-1 text-[12px] flex-wrap">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.label} href={l.href} className="text-ink-soft no-underline hover:text-ink-mid inline-flex items-center min-h-[36px]">
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}

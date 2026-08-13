import Link from 'next/link'
import { MintwareMark } from '@/components/ui2/MintwareMark'

// Shared platform footer (ATX Settlemint). Mounted once in the root layout so it
// renders on every page. Extracted verbatim from the homepage footer.
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
  { href: '/docs', label: 'Docs' },
  { href: '/about', label: 'About' },
  { href: 'https://x.com/Mintware_org', label: 'Twitter', external: true },
]

export function MwFooter() {
  return (
    <footer className="bg-ground-cool border-t border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-9 flex items-center justify-between flex-wrap gap-5">
        <Link href="/" className="flex items-center gap-2.5 no-underline text-ink">
          <MintwareMark size={24} />
          <b className="font-atx-display text-[16px] font-bold tracking-[-0.02em]">Mintware</b>
        </Link>
        <div className="flex gap-x-6 gap-y-1 text-[13px] font-medium flex-wrap">
          {FOOTER_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-ink-mid no-underline hover:text-ink inline-flex items-center min-h-[36px]"
              {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="text-[12px] text-ink-soft">© 2026 Mintware · Liquidity should be a public good</div>
      </div>
    </footer>
  )
}

import Link from 'next/link'

// Shared platform footer (ATX Settlemint). Mounted once in the root layout so it
// renders on every page. Extracted verbatim from the homepage footer.
// Current live app sections only — legacy static mockups (/explorer, /for-protocols.html)
// dropped. Add { href: '/docs', label: 'Docs' } once the docs section ships.
const FOOTER_LINKS = [
  { href: '/vaults', label: 'Vaults' },
  { href: '/rewards', label: 'Rewards' },
  { href: '/swap', label: 'Swap' },
  { href: '/agents', label: 'Agents' },
  { href: '/docs', label: 'Docs' },
  { href: 'https://x.com/Mintware_org', label: 'Twitter', external: true },
]

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

export function MwFooter() {
  return (
    <footer className="bg-atx-ink text-atx-bone font-atx-display [&_*]:rounded-none">
      <div className="mx-auto max-w-[1180px] px-6 py-[30px] flex items-center justify-between flex-wrap gap-4">
        <Link href="/" className="flex items-center gap-2.5 no-underline text-atx-bone">
          <Star className="w-5 h-5 text-atx-acid" />
          <b className="text-[15px] tracking-[0.06em]">MINTWARE</b>
        </Link>
        <div className="flex gap-5 font-atx-mono text-[10px] uppercase tracking-[0.1em] flex-wrap">
          {FOOTER_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-atx-bone/60 no-underline hover:text-atx-bone"
              {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="font-atx-mono text-[10px] text-atx-bone/45">© 2026 Mintware ✴ Contribution is identity</div>
      </div>
    </footer>
  )
}

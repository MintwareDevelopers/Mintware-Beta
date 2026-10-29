'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MintwareMark } from '@/components/ui2/MintwareMark'
import { isAppShellPath } from '@/components/web2/AppShell'

const LINKS = [
  { href: '/proof', label: 'Proof' },
  { href: '/the-math', label: 'The Math' },
  { href: '/docs', label: 'Docs' },
  { href: '/legal', label: 'Legal' },
  { href: '/risk-disclosures', label: 'Risk' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
]

export function MwFooter() {
  const pathname = usePathname()
  if (isAppShellPath(pathname) || pathname?.startsWith('/v1') || pathname?.startsWith('/markets/')) return null
  return <footer className="bg-ground-cool border-t border-hair-soft">
    <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-7 flex items-center justify-between flex-wrap gap-5">
      <Link href="/" className="flex items-center gap-2.5 no-underline text-ink"><MintwareMark size={24}/><b className="font-atx-display text-[16px] font-bold tracking-[-0.02em]">Mintware</b></Link>
      <nav aria-label="Footer" className="flex gap-x-6 gap-y-1 text-[13px] font-medium flex-wrap">{LINKS.map(l=><Link key={l.href} href={l.href} className="text-ink-mid no-underline hover:text-ink inline-flex items-center min-h-[40px]">{l.label}</Link>)}</nav>
    </div>
  </footer>
}

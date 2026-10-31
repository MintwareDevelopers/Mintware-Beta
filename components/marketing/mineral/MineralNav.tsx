import Link from 'next/link'
import { MineralMark } from '@/components/ui2/MineralMark'

// Landing header (Mineral): sticky, frosted porcelain, one solid primary action.
const LINKS: [string, string][] = [
  ['Markets', '/markets'],
  ['How it works', '#how'],
  ['RWAs', '/rwas'],
  ['Issuers', '/issuers'],
]

export function MineralNav() {
  return (
    <header
      className="sticky top-0 z-50"
      style={{ background: 'rgba(246,246,250,0.8)', backdropFilter: 'saturate(1.4) blur(14px)', WebkitBackdropFilter: 'saturate(1.4) blur(14px)', borderBottom: '1px solid rgba(21,21,29,0.05)' }}
    >
      <div className="mx-auto max-w-[1200px] px-[clamp(16px,4vw,40px)] py-3.5 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 no-underline" style={{ color: 'var(--mw-ink)' }}>
          <MineralMark size={30} />
          <span className="font-semibold text-[19px] tracking-[-0.02em]">Mintware</span>
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-x-[clamp(14px,2.4vw,32px)] gap-y-2 text-[15px]">
          {LINKS.map(([label, href]) => (
            <Link key={href} href={href} className="max-[720px]:hidden no-underline transition-colors hover:!text-[var(--mw-ink)]" style={{ color: 'var(--mw-ink-2)' }}>{label}</Link>
          ))}
          <Link href="/v1" className="mw-btn max-[720px]:!min-h-[40px] max-[720px]:text-[14px]">
            Launch app
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </Link>
        </nav>
      </div>
    </header>
  )
}

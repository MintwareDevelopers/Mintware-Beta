'use client'

// Team Treasury Terminal — the B2B shell. Sidebar IA modeled on Brex / Ramp / Safe
// Workspace: Overview → Vaults → Cards & Spend → Policy & Approvals → Team & Roles →
// Developers. Phase 1 skeleton: real structure + scope switcher, sections are
// design-forward. Distinct from the retail (User) top-nav app.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MintwareMark } from '@/components/ui2/MintwareMark'
import { ScopeSwitcher } from '@/components/web2/ScopeSwitcher'
import { TeamGuard } from '@/components/web2/TeamGuard'
import { useTeamSession } from '@/components/web2/useTeamSession'
import { can, type Permission } from '@/lib/auth/rbac'

// `perm` gates a section: it's shown only when the caller's role grants it (once the hard gate is ON).
// With the gate OFF (showcase), everything shows. Overview/Vaults/Swap/Cards need only treasury:view (any
// role); Policy/Team/Developers are the privileged sections.
const NAV: { href: string; label: string; perm?: Permission }[] = [
  { href: '/app/team',            label: 'Overview' },
  { href: '/app/team/vaults',     label: 'Vaults' },
  { href: '/app/team/swap',       label: 'Swap' },
  { href: '/app/team/cards',      label: 'Cards & Spend' },
  { href: '/app/team/policy',     label: 'Policy & Approvals', perm: 'spend:approve' },
  { href: '/app/team/team',       label: 'Team & Roles',       perm: 'roles:manage' },
  { href: '/app/team/developers', label: 'Developers',         perm: 'developers:manage' },
]

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isActive = (href: string) => (href === '/app/team' ? pathname === href : pathname.startsWith(href))
  const { session } = useTeamSession()
  // Only hide sections when enforcement is actually ON; otherwise keep the full showcase.
  const enforced = session?.enforced ?? false
  const role = session?.role ?? null
  const nav = NAV.filter((n) => !n.perm || !enforced || can(role, n.perm))

  return (
    <div className="min-h-screen flex bg-ground-cool text-ink font-atx-display overflow-x-clip">
      {/* ── Sidebar (desktop) ── */}
      <aside className="hidden md:flex flex-col w-[236px] shrink-0 sticky top-0 h-screen bg-white border-r border-hair">
        <div className="px-4 py-4 flex items-center gap-2.5 border-b border-hair-soft">
          <Link href="/" className="shrink-0"><MintwareMark size={22} /></Link>
          <ScopeSwitcher />
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5">
          {nav.map((n) => {
            const active = isActive(n.href)
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${active ? 'bg-ground-cool text-ink border-l-2 border-peri' : 'text-ink-mid hover:text-ink hover:bg-ground-cool/60 border-l-2 border-transparent'}`}
              >
                {n.label}
              </Link>
            )
          })}
        </nav>
        <div className="px-2.5 py-3 border-t border-hair-soft">
          <div className="rounded-lg bg-ground-cool px-3 py-2 text-[10px] text-ink-soft leading-[1.4]">
            <span className="inline-flex items-center gap-1.5 uppercase tracking-[0.1em] font-semibold text-peri-deep"><span className="w-[6px] h-[6px] rounded-full bg-peri inline-block" />Preview</span>
            <span className="block mt-1">Treasury terminal — design preview. Cards & settlement are coming.</span>
          </div>
          <Link href="/" className="block mt-2 px-3 text-[12px] text-ink-soft hover:text-ink">← Exit to site</Link>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 bg-white/85 backdrop-blur-[12px] border-b border-hair-soft">
          <div className="flex items-center gap-2.5 px-4 h-[56px]">
            <Link href="/" className="shrink-0"><MintwareMark size={22} /></Link>
            <ScopeSwitcher />
          </div>
          <nav className="flex gap-1 px-3 pb-2 overflow-x-auto">
            {nav.map((n) => {
              const active = isActive(n.href)
              return (
                <Link key={n.href} href={n.href} className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition-colors ${active ? 'bg-peri text-white' : 'text-ink-mid bg-ground-cool'}`}>
                  {n.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="max-w-[1120px] mx-auto px-6 py-8 max-[800px]:px-4 max-[800px]:py-6">
          <TeamGuard>{children}</TeamGuard>
        </div>
      </main>
    </div>
  )
}

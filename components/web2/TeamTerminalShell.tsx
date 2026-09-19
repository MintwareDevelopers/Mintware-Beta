'use client'

// TeamTerminalShell — the ONE chrome for every team/treasury surface: the illustrative
// `/app/team/*` terminal AND the real `/app/org/[slug]/*` treasury both render inside this same
// sidebar shell now, so crossing between "preview" and "real" sections never drops you onto the
// personal (MwNav) chrome. NAV hrefs resolve to the real org page once a wallet has an active org
// (Overview/Cards/Policy/Team & Roles); Vaults/Swap/Developers have no real per-org page yet and
// stay on the illustrative /app/team/* routes. See CONTEXT-MAP.md — this merge is why those two
// surfaces used to feel like leaving the app.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MintwareMark } from '@/components/ui2/MintwareMark'
import { ScopeSwitcher } from '@/components/web2/ScopeSwitcher'
import { TeamGuard } from '@/components/web2/TeamGuard'
import { TeamOrgBar } from '@/components/web2/TeamOrgBar'
import { useTeamSession } from '@/components/web2/useTeamSession'
import { useActiveOrg } from '@/components/web2/useActiveOrg'
import { can, type Permission } from '@/lib/auth/rbac'

type NavItem = { href: string; label: string; perm?: Permission }

function buildNav(activeOrgSlug: string | null): { core: NavItem[]; orgOnly: NavItem[] } {
  const org = (path: string) => (activeOrgSlug ? `/app/org/${activeOrgSlug}${path ? `/${path}` : ''}` : null)
  const core: NavItem[] = [
    { href: org('') ?? '/app/team', label: 'Overview' },
    { href: '/app/team/vaults', label: 'Vaults' },
    { href: '/app/team/swap', label: 'Swap' },
    { href: org('cards') ?? '/app/team/cards', label: 'Cards & Spend' },
    { href: org('control') ?? '/app/team/policy', label: 'Policy & Approvals', perm: 'spend:approve' },
    { href: org('roles') ?? '/app/team/team', label: 'Team & Roles', perm: 'roles:manage' },
    { href: '/app/team/developers', label: 'Developers', perm: 'developers:manage' },
  ]
  const orgOnly: NavItem[] = activeOrgSlug
    ? [
        { href: org('fund')!, label: 'Savings' },
        { href: org('pay')!, label: 'Pay a vendor' },
        { href: org('payroll')!, label: 'Payroll' },
        { href: org('activity')!, label: 'Activity' },
      ]
    : []
  return { core, orgOnly }
}

export function TeamTerminalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { session } = useTeamSession()
  const { active } = useActiveOrg()

  // Only hide sections when enforcement is actually ON; otherwise keep the full showcase.
  const enforced = session?.enforced ?? false
  const role = session?.role ?? null
  const { core, orgOnly } = buildNav(active?.slug ?? null)
  const overviewHref = core[0].href
  const isActive = (href: string) => (href === overviewHref ? pathname === href : pathname.startsWith(href))
  const visibleCore = core.filter((n) => !n.perm || !enforced || can(role, n.perm))

  const renderLinks = (items: NavItem[], mobile: boolean) =>
    items.map((n) => {
      const activeItem = isActive(n.href)
      return (
        <Link
          key={n.href}
          href={n.href}
          className={
            mobile
              ? `shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition-colors ${activeItem ? 'bg-peri text-white' : 'text-ink-mid bg-ground-cool'}`
              : `rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${activeItem ? 'bg-ground-cool text-ink border-l-2 border-peri' : 'text-ink-mid hover:text-ink hover:bg-ground-cool/60 border-l-2 border-transparent'}`
          }
        >
          {n.label}
        </Link>
      )
    })

  return (
    <div className="min-h-screen flex bg-ground-cool text-ink font-atx-display overflow-x-clip">
      {/* ── Sidebar (desktop) ── */}
      <aside className="hidden md:flex flex-col w-[236px] shrink-0 sticky top-0 h-screen bg-white border-r border-hair">
        <div className="px-4 py-4 flex items-center gap-2.5 border-b border-hair-soft">
          <Link href="/" className="shrink-0"><MintwareMark size={22} /></Link>
          <ScopeSwitcher />
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5">
          {renderLinks(visibleCore, false)}
          {orgOnly.length > 0 && (
            <>
              <div className="mt-3 mb-1 px-3 text-[9px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Payments</div>
              {renderLinks(orgOnly, false)}
            </>
          )}
        </nav>
        <div className="px-2.5 py-3 border-t border-hair-soft">
          <div className="rounded-lg bg-ground-cool px-3 py-2 text-[10px] text-ink-soft leading-[1.4]">
            <span className="inline-flex items-center gap-1.5 uppercase tracking-[0.1em] font-semibold text-peri-deep"><span className="w-[6px] h-[6px] rounded-full bg-peri inline-block" />{active ? 'Treasury' : 'Preview'}</span>
            <span className="block mt-1">{active ? `${active.name} — real treasury actions run here.` : 'Treasury terminal — design preview. Create an org to go live.'}</span>
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
            {renderLinks([...visibleCore, ...orgOnly], true)}
          </nav>
        </div>

        <div className="max-w-[1120px] mx-auto px-6 py-8 max-[800px]:px-4 max-[800px]:py-6">
          <TeamOrgBar />
          <TeamGuard>{children}</TeamGuard>
        </div>
      </main>
    </div>
  )
}

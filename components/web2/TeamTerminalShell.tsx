'use client'

// TeamTerminalShell — the Team workspace of the shared AppShell. Both the illustrative `/app/team/*`
// terminal AND the real `/app/org/[slug]/*` treasury render here, so crossing between "preview" and
// "real" sections never changes the chrome. NAV hrefs resolve to the real org page once a wallet has an
// active org (Overview/Cards/Policy/Team & Roles); Vaults/Swap/Developers have no real per-org page yet
// and stay on the illustrative /app/team/* routes.

import { AppShell, type ShellNavGroup, type ShellNavItem } from '@/components/web2/AppShell'
import { TeamGuard } from '@/components/web2/TeamGuard'
import { TeamOrgBar } from '@/components/web2/TeamOrgBar'
import { useTeamSession } from '@/components/web2/useTeamSession'
import { useActiveOrg } from '@/components/web2/useActiveOrg'
import { can, type Permission } from '@/lib/auth/rbac'

type NavItem = ShellNavItem & { perm?: Permission }

function buildNav(activeOrgSlug: string | null): { core: NavItem[]; orgOnly: NavItem[] } {
  const org = (path: string) => (activeOrgSlug ? `/app/org/${activeOrgSlug}${path ? `/${path}` : ''}` : null)
  const core: NavItem[] = [
    { href: org('') ?? '/app/team', label: 'Overview', exact: true },
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
  const { session } = useTeamSession()
  const { active } = useActiveOrg()

  // Only hide sections when enforcement is actually ON; otherwise keep the full showcase.
  const enforced = session?.enforced ?? false
  const role = session?.role ?? null
  const { core, orgOnly } = buildNav(active?.slug ?? null)
  const visibleCore = core.filter((n) => !n.perm || !enforced || can(role, n.perm))
  const groups: ShellNavGroup[] = [{ items: visibleCore }]
  if (orgOnly.length) groups.push({ title: 'Payments', items: orgOnly })

  return (
    <AppShell
      groups={groups}
      padded
      footer={
        <div className="rounded-lg bg-white border border-hair-soft px-3 py-2 text-[10.5px] text-ink-soft leading-[1.4]">
          <span className="inline-flex items-center gap-1.5 uppercase tracking-[0.1em] font-semibold text-peri-deep"><span className="w-[6px] h-[6px] rounded-full bg-peri inline-block" />{active ? 'Treasury' : 'Preview'}</span>
          <span className="block mt-1">{active ? `${active.name} — real treasury actions run here.` : 'Design preview. Create an org to go live.'}</span>
        </div>
      }
    >
      <TeamOrgBar />
      <TeamGuard>{children}</TeamGuard>
    </AppShell>
  )
}

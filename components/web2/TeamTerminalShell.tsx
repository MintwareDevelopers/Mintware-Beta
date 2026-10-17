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

function buildNav(activeOrgSlug: string | null): { groups: { title?: string; items: NavItem[] }[] } {
  const org = (path: string) => (activeOrgSlug ? `/app/org/${activeOrgSlug}${path ? `/${path}` : ''}` : null)
  // Items that stay illustrative even with a real org carry a "Preview" hint so mock and real never look alike.
  const preview = activeOrgSlug ? 'Preview' : undefined
  return {
    groups: [
      { items: [{ href: org('') ?? '/app/team', label: 'Overview', exact: true }] },
      {
        title: 'Treasury',
        items: [
          ...(activeOrgSlug ? [{ href: org('fund')!, label: 'Treasury yield' }] : []),
          { href: '/app/team/vaults', label: 'Allocation', hint: preview },
          { href: '/app/team/swap', label: 'Swap' },
        ],
      },
      {
        // IA audit 2026-10-02: the token-issuer flows moved here from Personal — they were never retail jobs.
        title: 'Liquidity for your token',
        items: [
          { href: '/app/team/liquidity', label: 'Choose a model', exact: true },
          { href: '/app/team/liquidity/launch', label: 'Community-matched launch' },
          { href: '/app/team/liquidity/create', label: 'Seed a balanced pool' },
          { href: '/app/team/liquidity/staged', label: 'Stage one side' },
        ],
      },
      {
        title: 'Spend',
        items: [
          { href: org('cards') ?? '/app/team/cards', label: 'Cards & Spend' },
          ...(activeOrgSlug
            ? [{ href: org('pay')!, label: 'Pay a vendor' }, { href: org('payroll')!, label: 'Payroll' }, { href: org('activity')!, label: 'Activity' }]
            : []),
        ],
      },
      {
        title: 'Admin',
        items: [
          // The real page is "Treasury control" (multisig + role caps) — there is no approvals queue yet.
          { href: org('control') ?? '/app/team/policy', label: 'Treasury controls', perm: 'spend:approve' },
          { href: org('roles') ?? '/app/team/team', label: 'Team & Roles', perm: 'roles:manage' },
          { href: '/app/team/developers', label: 'Developers', hint: preview, perm: 'developers:manage' },
        ],
      },
    ],
  }
}

export function TeamTerminalShell({ children }: { children: React.ReactNode }) {
  const { session } = useTeamSession()
  const { active } = useActiveOrg()

  // Only hide sections when enforcement is actually ON; otherwise keep the full showcase.
  const enforced = session?.enforced ?? false
  const role = session?.role ?? null
  const groups: ShellNavGroup[] = buildNav(active?.slug ?? null).groups
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.perm || !enforced || can(role, n.perm)) }))
    .filter((g) => g.items.length > 0)

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

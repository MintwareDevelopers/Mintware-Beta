import { PersonalShell } from '@/components/web2/AppShell'

// Personal workspace — every retail route (account, swap, vaults, liquidity, agents, profile) shares the
// one AppShell chrome. URLs are unchanged: (personal) is a route group.
export default function PersonalLayout({ children }: { children: React.ReactNode }) {
  return <PersonalShell>{children}</PersonalShell>
}

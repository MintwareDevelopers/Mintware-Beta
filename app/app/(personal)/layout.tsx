import { PersonalShell } from '@/components/web2/AppShell'

// Personal workspace — markets, portfolio, swap, the RWA demo and the simulated previews share the one AppShell
// chrome. Open to everyone (one app, 2026-10-31); only the Team workspace keeps the V2 password (V2AppGate).
export const dynamic = 'force-dynamic'

export default function PersonalLayout({ children }: { children: React.ReactNode }) {
  return <PersonalShell>{children}</PersonalShell>
}

'use client'

// Team Treasury Terminal — the B2B shell. Sidebar IA modeled on Brex / Ramp / Safe
// Workspace: Overview → Vaults → Cards & Spend → Policy & Approvals → Team & Roles →
// Developers. The chrome itself lives in TeamTerminalShell, shared with the REAL
// /app/org/[slug]/* treasury (see that layout) so the two team surfaces read as one product.

import { TeamTerminalShell } from '@/components/web2/TeamTerminalShell'

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return <TeamTerminalShell>{children}</TeamTerminalShell>
}

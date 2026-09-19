'use client'

// Shares the Team Terminal shell with /app/team/* — the org hub (this level) and the [slug]
// treasury pages are the REAL side of the same product, not a separate app. `accept` (outside
// this route group) stays unwrapped: an invitee who hasn't joined yet shouldn't see the terminal
// sidebar for an org they're not a member of.

import { TeamTerminalShell } from '@/components/web2/TeamTerminalShell'

export default function OrgHubLayout({ children }: { children: React.ReactNode }) {
  return <TeamTerminalShell>{children}</TeamTerminalShell>
}

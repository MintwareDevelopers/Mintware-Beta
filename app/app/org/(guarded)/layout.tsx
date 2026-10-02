import { TeamTerminalShell } from '@/components/web2/TeamTerminalShell'
import { V2AppGate } from '@/components/web2/V2AppGate'

// Shares the Team Terminal shell with /app/team/* — the org hub (this level) and the [slug] treasury pages are the
// REAL side of the same product. `accept` (outside this route group) stays unwrapped and ungated: an invitee who
// hasn't joined yet shouldn't need the V2 password or see the terminal for an org they're not in. V2-gated.
export const dynamic = 'force-dynamic'

export default function OrgHubLayout({ children }: { children: React.ReactNode }) {
  return <V2AppGate><TeamTerminalShell>{children}</TeamTerminalShell></V2AppGate>
}

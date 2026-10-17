import { TeamTerminalShell } from '@/components/web2/TeamTerminalShell'
import { V2AppGate } from '@/components/web2/V2AppGate'

// Shares the Team Terminal shell with /app/team/* — see app/app/org/(guarded)/layout.tsx. `accept` (a sibling of
// this route group) stays unwrapped and ungated on purpose. V2-gated.
export const dynamic = 'force-dynamic'

export default function OrgSlugLayout({ children }: { children: React.ReactNode }) {
  return <V2AppGate><TeamTerminalShell>{children}</TeamTerminalShell></V2AppGate>
}

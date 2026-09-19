'use client'

// Shares the Team Terminal shell with /app/team/* — see app/app/org/(guarded)/layout.tsx for why.
// `accept` (a sibling of this route group, not inside it) stays unwrapped on purpose.

import { TeamTerminalShell } from '@/components/web2/TeamTerminalShell'

export default function OrgSlugLayout({ children }: { children: React.ReactNode }) {
  return <TeamTerminalShell>{children}</TeamTerminalShell>
}

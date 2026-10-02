import { TeamTerminalShell } from '@/components/web2/TeamTerminalShell'
import { V2AppGate } from '@/components/web2/V2AppGate'

// Team Treasury Terminal — illustrative /app/team/* sections. Same chrome as the REAL /app/org/[slug]/* treasury
// (TeamTerminalShell). V2-gated (V2AppGate).
export const dynamic = 'force-dynamic'

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return <V2AppGate><TeamTerminalShell>{children}</TeamTerminalShell></V2AppGate>
}

import { PersonalShell } from '@/components/web2/AppShell'
import { V2AppGate } from '@/components/web2/V2AppGate'

// Personal workspace — every retail route (account, swap, vaults, agents, profile) shares the one AppShell chrome.
// URLs are unchanged: (personal) is a route group. V2-gated (V2AppGate).
export const dynamic = 'force-dynamic'

export default function PersonalLayout({ children }: { children: React.ReactNode }) {
  return <V2AppGate><PersonalShell>{children}</PersonalShell></V2AppGate>
}

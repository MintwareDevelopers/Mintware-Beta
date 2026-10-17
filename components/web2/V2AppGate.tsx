import { cookies } from 'next/headers'
import { V2_COOKIE, hasV2Unlock } from '@/lib/v2/gate'
import { V2Access } from '@/components/web2/V2Access'

// Server gate for the V2 app (user decision 2026-10-02: "gate all of /app"). Every workspace layout (Personal,
// Team, org, RWA) wraps its shell in this, so a deep link into /app can no longer skip the V2 password the Launch
// modal asks for. Not used by /app/org/[slug]/accept (an invitee joining an org) — that page sits outside the
// guarded layouts on purpose. Locked ⇒ the access screen renders INSTEAD of the page (nothing behind it in the HTML).
export async function V2AppGate({ children, variant = 'app' }: { children: React.ReactNode; variant?: 'app' | 'rwa' }) {
  const unlocked = hasV2Unlock((await cookies()).get(V2_COOKIE)?.value)
  if (!unlocked) return <V2Access variant={variant} />
  return <>{children}</>
}

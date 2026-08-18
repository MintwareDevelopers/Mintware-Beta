'use client'

// Client half of the Phase-2 hard gate for the Team terminal. The edge middleware (lib/auth/gate.ts) is
// the front door — when TEAM_HARD_GATE is on it already redirects unauthenticated / role-less visitors
// before the page loads. This component is the SECOND layer: it asks the server (/api/team/session, which
// re-verifies the Privy session authoritatively) whether the caller really has team access, and redirects
// out if not — catching the case where someone forged the coarse `mw_role` cookie the middleware trusts.
//
// It renders children optimistically (no flash / no degradation when the gate is OFF — enforced=false), and
// only redirects once the server has spoken. Real team DATA is additionally gated server-side in its own
// routes (verifyPrivySession), so this client check is UX, never the security boundary.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const USER_HOME = '/app/account'

export function TeamGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    fetch('/api/team/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((s: { enforced?: boolean; hasTeamAccess?: boolean }) => {
        if (cancelled) return
        if (s.enforced && !s.hasTeamAccess) router.replace(USER_HOME)
      })
      .catch(() => {
        // Network/parse error → leave the (illustrative) UI up; the server data layer is the real gate.
      })
    return () => {
      cancelled = true
    }
  }, [router])

  return <>{children}</>
}

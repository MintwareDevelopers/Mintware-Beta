'use client'

// Client hook over /api/team/session (the authoritative server check). Gives the team shell the caller's
// role so it can gate NAV / controls by permission. This is UX only — the real boundary is server-side
// (lib/auth/requireTeam). When the hard gate is OFF (`enforced=false`), the surface stays fully open
// (showcase), so callers should only hide things when `enforced` is true.

import { useEffect, useState } from 'react'
import type { TeamRole } from '@/lib/auth/rbac'

export type TeamSession = {
  enforced: boolean
  authenticated: boolean
  role: TeamRole | null
  hasTeamAccess: boolean
}

export function useTeamSession(): { session: TeamSession | null; loading: boolean } {
  const [session, setSession] = useState<TeamSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/team/session', { cache: 'no-store' })
      .then((r) => r.json())
      .then((s: TeamSession) => {
        if (!cancelled) {
          setSession(s)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false) // leave session null; callers keep the showcase up
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { session, loading }
}

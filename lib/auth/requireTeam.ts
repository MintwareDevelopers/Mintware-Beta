// The SERVER-SIDE security boundary for Team (Treasury Terminal) data routes — Phase 2 hard gate.
//
// rbac.ts defines the role/permission matrix; session.ts authoritatively verifies the Privy token and
// re-derives the caller's active-org role. This module is the guard every team DATA route calls BEFORE
// returning org data: verify → require team access → (optionally) require a specific permission. Fails
// closed (verifyPrivySession returns null when unconfigured / token bad → 401). The middleware + TeamGuard
// are only coarse UX; THIS is the boundary.
//
// Usage in a route handler (Node runtime):
//   const auth = await requireTeamPermission(token, 'spend:approve')
//   if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
//   // auth.role / auth.userId are trustworthy here

import { verifyPrivySession, type VerifiedSession } from './session'
import { can, hasTeamAccess, type Permission, type TeamRole } from './rbac'

export type TeamAuthResult =
  | { ok: true; userId: string; role: TeamRole | null }
  | { ok: false; status: 401 | 403; error: 'unauthenticated' | 'no_team_access' | 'forbidden' }

/** Pure decision from an already-verified session — the testable core. */
export function evaluateTeamAuth(session: VerifiedSession | null, permission?: Permission): TeamAuthResult {
  if (!session) return { ok: false, status: 401, error: 'unauthenticated' }
  if (!hasTeamAccess(session.role)) return { ok: false, status: 403, error: 'no_team_access' }
  if (permission && !can(session.role, permission)) return { ok: false, status: 403, error: 'forbidden' }
  return { ok: true, userId: session.userId, role: session.role }
}

/** Verify the Privy token and enforce team access (+ optional permission). The security boundary for team
 *  data routes. Returns a discriminated result — never throws for an auth failure. */
export async function requireTeamPermission(
  token: string | null | undefined,
  permission?: Permission,
): Promise<TeamAuthResult> {
  return evaluateTeamAuth(await verifyPrivySession(token), permission)
}

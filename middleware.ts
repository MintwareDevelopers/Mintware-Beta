// Phase-2 hard-gate middleware for the User/Team app split.
//
// DEFAULT: OFF. The whole gate is behind the server flag `TEAM_HARD_GATE` — unset/`false` makes this a
// pass-through, so the current soft-gated showcase (illustrative data, no sign-in) is completely
// unaffected. Set `TEAM_HARD_GATE=true` to enforce.
//
// LAYERING: this is a COARSE, cookie-level UX redirect (send an unauthenticated visitor to sign-in, send a
// role-less user out of the treasury terminal). It is deliberately edge-light and trusts cookie PRESENCE.
// The authoritative check is server-side: lib/auth/session.ts#verifyPrivySession re-verifies the Privy
// token + re-derives the role before any org data is returned. Never rely on this middleware alone.

import { NextResponse, type NextRequest } from 'next/server'
import { evaluateGate, type GateSession } from '@/lib/auth/gate'
import { isTeamRole, type TeamRole } from '@/lib/auth/rbac'
import { PRIVY_TOKEN_COOKIE, MW_ROLE_COOKIE } from '@/lib/auth/cookies'

// Only run on the app surface — marketing pages are always public.
export const config = { matcher: ['/app/:path*'] }

export function middleware(req: NextRequest) {
  const hardGateEnabled = process.env.TEAM_HARD_GATE === 'true'
  if (!hardGateEnabled) return NextResponse.next()

  const token = req.cookies.get(PRIVY_TOKEN_COOKIE)?.value
  const roleRaw = req.cookies.get(MW_ROLE_COOKIE)?.value
  const role: TeamRole | null = isTeamRole(roleRaw) ? roleRaw : null

  const session: GateSession = { authenticated: Boolean(token), role }
  const result = evaluateGate(req.nextUrl.pathname, session, { hardGateEnabled })

  if (result.action === 'redirect') {
    const url = new URL(result.to, req.url)
    // Preserve where the user was headed so sign-in can bounce them back.
    if (result.reason === 'unauthenticated') url.searchParams.set('next', req.nextUrl.pathname)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

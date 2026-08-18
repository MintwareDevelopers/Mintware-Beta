// Authoritative team-access endpoint — the SECURITY BOUNDARY for the hard gate. The edge middleware
// (lib/auth/gate.ts) does a coarse cookie redirect; THIS route re-verifies the Privy session server-side
// (verifyPrivySession, Node runtime) and re-derives the role from Privy metadata, so a forged `mw_role`
// cookie cannot grant access. The client team shell calls it to hard-gate; every future team DATA route
// should reuse `verifyPrivySession` the same way before returning org data.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyPrivySession, PRIVY_TOKEN_COOKIE } from '@/lib/auth/session'
import { hasTeamAccess } from '@/lib/auth/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // reads request cookies — never static

export async function GET() {
  // Read server-side so the flag stays server-only; the client learns enforcement state from the response.
  const enforced = process.env.TEAM_HARD_GATE === 'true'
  const token = (await cookies()).get(PRIVY_TOKEN_COOKIE)?.value
  const session = await verifyPrivySession(token)
  const role = session?.role ?? null
  return NextResponse.json({
    enforced,
    authenticated: Boolean(session),
    role,
    hasTeamAccess: hasTeamAccess(role),
  })
}

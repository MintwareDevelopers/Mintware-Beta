// The pure gate-decision function behind the Phase-2 hard-gate middleware. Kept dependency-free so it is
// exhaustively unit-tested without Next internals; `middleware.ts` is a thin adapter that reads the request
// (env flag + Privy cookies) into a `GateSession` and applies the returned decision.
//
// IMPORTANT — layering: this middleware gate is a COARSE, cookie-level UX redirect (is there a session at
// all + which home to land in). It is NOT the security boundary — the server data layer re-verifies the
// Privy session cryptographically (see lib/auth/session.ts) before returning any org data. This matches
// Next.js guidance: optimistic check in middleware, authoritative check in the data layer.

import type { TeamRole } from './rbac'
import { hasTeamAccess } from './rbac'

/** What the middleware knows about the caller from cookies (coarse — verified server-side later). */
export type GateSession = {
  /** A Privy session token cookie is present. */
  authenticated: boolean
  /** The caller's role in their active org, from a companion cookie set post-login. Null = no team role. */
  role: TeamRole | null
}

export type GateConfig = {
  /** Server flag `TEAM_HARD_GATE`. When false, the gate is a no-op (the showcase is untouched). */
  hardGateEnabled: boolean
  /** Prefixes that require a TEAM role (the treasury terminal). */
  teamPrefixes?: readonly string[]
  /** Prefixes that require ANY authenticated session (personal money surfaces). */
  authPrefixes?: readonly string[]
  /** Where to send an unauthenticated caller. */
  signInPath?: string
  /** Where to send an authenticated caller who lacks team access (their personal home). */
  userHome?: string
}

export type GateResult = { action: 'allow' } | { action: 'redirect'; to: string; reason: GateReason }
export type GateReason = 'unauthenticated' | 'no-team-access'

const DEFAULTS = {
  teamPrefixes: ['/app/team'] as const,
  authPrefixes: ['/app/account'] as const,
  signInPath: '/?signin=1',
  userHome: '/app/account',
}

function matches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/** Decide allow / redirect for one request. Pure. */
export function evaluateGate(pathname: string, session: GateSession, config: GateConfig): GateResult {
  // Flag off → showcase mode, never redirect.
  if (!config.hardGateEnabled) return { action: 'allow' }

  const teamPrefixes = config.teamPrefixes ?? DEFAULTS.teamPrefixes
  const authPrefixes = config.authPrefixes ?? DEFAULTS.authPrefixes
  const signInPath = config.signInPath ?? DEFAULTS.signInPath
  const userHome = config.userHome ?? DEFAULTS.userHome

  const isTeam = matches(pathname, teamPrefixes)
  const isAuthOnly = matches(pathname, authPrefixes)

  // Unprotected path → allow.
  if (!isTeam && !isAuthOnly) return { action: 'allow' }

  // Any protected path first requires an authenticated session.
  if (!session.authenticated) {
    return { action: 'redirect', to: signInPath, reason: 'unauthenticated' }
  }

  // Team surface additionally requires a team role; send a role-less user to their personal home.
  // (Avoid a redirect loop: if the personal home itself is a team prefix — misconfig — just allow.)
  if (isTeam && !hasTeamAccess(session.role)) {
    if (matches(userHome, teamPrefixes)) return { action: 'allow' }
    return { action: 'redirect', to: userHome, reason: 'no-team-access' }
  }

  return { action: 'allow' }
}

// Server-side Privy session verification — the AUTHORITATIVE access check for the Team surface (the
// middleware gate in lib/auth/gate.ts is only a coarse cookie redirect). Runs in the Node runtime (server
// components / route handlers), NOT the edge middleware, because Privy verification needs the app secret.
//
// FAILS CLOSED: any missing config, missing package, bad token, or error returns null (no session), never
// a half-trusted one. `@privy-io/server-auth` is loaded LAZILY (dynamic import) so this module compiles and
// runs even when the package isn't installed in the current environment — in that case verification simply
// returns null (the hard gate can't be relied on until it's installed + PRIVY_APP_SECRET is set, which is
// exactly the deploy-gated state).

import { activeRole, type MintwareOrgMeta, type TeamRole } from './rbac'

// Re-exported for server callers that already import from session.ts; canonical home is ./cookies.
export { PRIVY_TOKEN_COOKIE, MW_ROLE_COOKIE } from './cookies'

export type VerifiedSession = {
  userId: string
  /** The caller's role in their active org, re-derived from Privy custom metadata (authoritative). */
  role: TeamRole | null
}

function credentials(): { appId: string; appSecret: string } | null {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()
  const appSecret = process.env.PRIVY_APP_SECRET?.trim()
  if (!appId || !appSecret) return null // unconfigured → fail closed
  return { appId, appSecret }
}

// Minimal structural view of the bits of @privy-io/server-auth we use — kept local so this file doesn't
// hard-depend on the package's types (it may be absent in some environments).
type PrivyLike = {
  verifyAuthToken: (token: string) => Promise<{ userId: string }>
  getUser: (userId: string) => Promise<{ customMetadata?: Record<string, unknown> } | null>
}

let _client: PrivyLike | null = null
async function client(): Promise<PrivyLike | null> {
  if (_client) return _client
  const creds = credentials()
  if (!creds) return null
  try {
    const mod: unknown = await import('@privy-io/server-auth')
    const Ctor = (mod as { PrivyClient?: new (id: string, secret: string) => PrivyLike }).PrivyClient
    if (!Ctor) return null
    _client = new Ctor(creds.appId, creds.appSecret)
    return _client
  } catch {
    return null // package not installed in this environment → fail closed
  }
}

/** Verify a Privy access token and re-derive the caller's active-org role from their custom metadata.
 *  Returns null on any failure (unconfigured, package absent, invalid/expired token, network error). */
export async function verifyPrivySession(accessToken: string | undefined | null): Promise<VerifiedSession | null> {
  if (!accessToken) return null
  const c = await client()
  if (!c) return null
  try {
    const claims = await c.verifyAuthToken(accessToken)
    const user = await c.getUser(claims.userId)
    const meta = (user?.customMetadata ?? {}) as MintwareOrgMeta
    return { userId: claims.userId, role: activeRole(meta) }
  } catch {
    return null // invalid/expired token or transient error → no session
  }
}

/** True when the server has the credentials to enforce (both Privy app id + secret are set). When false,
 *  the hard gate must not be relied on as a security boundary — the surface is showcase-only. */
export function sessionEnforcementConfigured(): boolean {
  return credentials() !== null
}

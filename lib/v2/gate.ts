import { createHash } from 'crypto'

// Password token for guarded /app workspaces. Public marketing pages do not use this gate.

export const V2_PASSWORD = process.env.V2_PASSWORD ?? ''
export const V2_COOKIE = 'mw_v2'

// Opaque token derived from the password — the literal password never sits in the cookie.
export function v2Token(): string {
  return V2_PASSWORD ? createHash('sha256').update(`mw-v2:${V2_PASSWORD}`).digest('hex') : ''
}

// Fail-closed: V2_PASSWORD unset ⇒ nobody is in.
export function hasV2Unlock(cookieVal: string | undefined): boolean {
  const t = v2Token()
  return !!t && cookieVal === t
}

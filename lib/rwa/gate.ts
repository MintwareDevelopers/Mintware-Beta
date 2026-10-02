import { createHash } from 'crypto'

// V2-RWAs partner access — its OWN password (RWA_ACCESS_PASSWORD) and cookie, separate from the deck / data-room
// gates, so RWA access can be shared with an issuer partner on its own. Same posture as lib/deck/gate.ts:
// UNSET ⇒ the gate is closed to everyone (fail-closed); the cookie holds a hash, never the password.
export const RWA_ACCESS_PASSWORD = process.env.RWA_ACCESS_PASSWORD ?? ''
export const RWA_COOKIE = 'mw_rwa'

export function rwaToken(): string {
  return RWA_ACCESS_PASSWORD ? createHash('sha256').update(`mw-rwa:${RWA_ACCESS_PASSWORD}`).digest('hex') : ''
}

export function isRwaUnlocked(cookieVal: string | undefined): boolean {
  const t = rwaToken()
  return !!t && cookieVal === t
}

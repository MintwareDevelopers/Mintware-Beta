import { createHash } from 'crypto'

// V1/V2 split. V1 = the live LP Gateway (what "Launch app" serves by default). V2 = the full vision
// (treasury OS, YPN, cards, agents), password-gated + viewable to investors. Mirrors the /deck gate.
//
// DARK-LAUNCHED behind NEXT_PUBLIC_V1_MODE_ENABLED: while OFF (default), V2 shows everywhere (current
// behavior, zero change) so this can ship before V1 is fully built. Flip it ON to make V1 the default
// and gate V2 behind the password.

export const V2_PASSWORD = process.env.V2_PASSWORD ?? ''
export const V2_COOKIE = 'mw_v2'

// Opaque token derived from the password — the literal password never sits in the cookie.
export function v2Token(): string {
  return V2_PASSWORD ? createHash('sha256').update(`mw-v2:${V2_PASSWORD}`).digest('hex') : ''
}

export function v1ModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_V1_MODE_ENABLED === 'true'
}

// Server-side truth: is this visitor seeing V2? True when the split is off (V2 everywhere), or when the
// valid unlock cookie is present. The layout reads the cookie and hands this down to the client provider.
export function isV2FromCookie(cookieVal: string | undefined): boolean {
  if (!v1ModeEnabled()) return true
  const t = v2Token()
  return !!t && cookieVal === t
}

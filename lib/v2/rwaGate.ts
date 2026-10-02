import { V2_COOKIE, v2Token } from './gate'

// V2-RWAs gate (user decision 2026-10-02: "the V2 password is enough" — no separate RWA password):
//   1. EXISTS — NEXT_PUBLIC_V2_RWA_ENABLED === 'true'. Off ⇒ the vertical does not exist (pages + APIs 404).
//   2. OPEN   — the visitor holds a VALID V2 unlock cookie, i.e. they entered V2_PASSWORD (Launch modal or the
//               RWA access screen, both POST /api/v2/unlock). Deliberately STRICTER than isV2FromCookie, which is
//               true for everyone while NEXT_PUBLIC_V1_MODE_ENABLED is off — that would make RWA public.
//               Fail-closed: V2_PASSWORD unset ⇒ nobody is ever in.
export function v2RwaFlagOn(): boolean {
  return process.env.NEXT_PUBLIC_V2_RWA_ENABLED === 'true'
}

/** Layer 1 — the vertical exists (else 404). */
export function isV2RwaVisible(): boolean {
  return v2RwaFlagOn()
}

/** The visitor really entered the V2 password (independent of the site-wide V1/V2 default). */
export function hasV2Unlock(v2CookieVal: string | undefined): boolean {
  const t = v2Token()
  return !!t && v2CookieVal === t
}

type CookieJar = { get(name: string): { value: string } | undefined }

/** Both layers — use for anything that shows demo data. */
export function canSeeRwa(cookies: CookieJar): boolean {
  return v2RwaFlagOn() && hasV2Unlock(cookies.get(V2_COOKIE)?.value)
}

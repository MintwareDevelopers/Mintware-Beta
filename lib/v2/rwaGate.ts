import { isV2FromCookie, V2_COOKIE } from './gate'
import { isRwaUnlocked, RWA_COOKIE } from '@/lib/rwa/gate'

// V2-RWAs gate, in two layers:
//   1. EXISTS  — NEXT_PUBLIC_V2_RWA_ENABLED === 'true' AND the visitor passes the V2 gate. Otherwise the vertical
//                does not exist for them (pages 404, APIs 404).
//   2. UNLOCKED — the visitor also holds the RWA partner-access cookie (RWA_ACCESS_PASSWORD, lib/rwa/gate.ts).
//                Until then /app/rwa shows the branded access screen and nothing else; market pages redirect
//                there; the APIs refuse. Fail-closed: no password configured ⇒ nobody is ever unlocked.
export function v2RwaFlagOn(): boolean {
  return process.env.NEXT_PUBLIC_V2_RWA_ENABLED === 'true'
}

/** Layer 1 only — the vertical exists for this visitor. */
export function isV2RwaVisible(v2CookieVal: string | undefined): boolean {
  return v2RwaFlagOn() && isV2FromCookie(v2CookieVal)
}

type CookieJar = { get(name: string): { value: string } | undefined }

/** Both layers — exists AND unlocked. Use for anything that shows demo data. */
export function canSeeRwa(cookies: CookieJar): boolean {
  return isV2RwaVisible(cookies.get(V2_COOKIE)?.value) && isRwaUnlocked(cookies.get(RWA_COOKIE)?.value)
}

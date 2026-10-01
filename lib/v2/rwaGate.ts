import { isV2FromCookie } from './gate'

// V2-RWAs gate. The RWA liquidity vertical shows ONLY when BOTH hold:
//   1. the visitor passes the V2 gate (unlock cookie, or the V1/V2 split is off), and
//   2. NEXT_PUBLIC_V2_RWA_ENABLED === 'true' (default OFF — dark launch).
// Server components call this and `notFound()` otherwise, so nothing about the vertical ships to anyone else.
export function v2RwaFlagOn(): boolean {
  return process.env.NEXT_PUBLIC_V2_RWA_ENABLED === 'true'
}

export function isV2RwaVisible(cookieVal: string | undefined): boolean {
  return v2RwaFlagOn() && isV2FromCookie(cookieVal)
}

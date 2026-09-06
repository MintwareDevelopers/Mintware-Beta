import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { isV2FromCookie, V2_COOKIE } from '@/lib/v2/gate'
import { V1AppHome } from '@/components/web2/V1AppHome'

// App door. V1 (default): the live LP Gateway home. V2 (unlocked): routes into the last-picked context
// (Team → treasury terminal, else the retail Liquid Sovereign Account). Mode is dark-launched behind
// NEXT_PUBLIC_V1_MODE_ENABLED (see lib/v2/gate.ts) — OFF ⇒ V2 everywhere, unchanged.
export default async function AppHome() {
  const store = await cookies()
  if (!isV2FromCookie(store.get(V2_COOKIE)?.value)) return <V1AppHome />
  const mode = store.get('mw_app_mode')?.value
  redirect(mode === 'team' ? '/app/team' : '/app/account')
}

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { isV2FromCookie, V2_COOKIE } from '@/lib/v2/gate'

// App door. V1 (flag-on default): the live LP Gateway lives at its own dark app surface — send there.
// V2 (unlocked): route into the last-picked context (Team → treasury terminal, else the retail Liquid
// Sovereign Account). Mode is dark-launched behind NEXT_PUBLIC_V1_MODE_ENABLED (see lib/v2/gate.ts) —
// OFF ⇒ V2 everywhere, unchanged. The Launch chooser also routes to /v1 directly for the V1 track.
export default async function AppHome() {
  const store = await cookies()
  if (!isV2FromCookie(store.get(V2_COOKIE)?.value)) redirect('/v1')
  const mode = store.get('mw_app_mode')?.value
  redirect(mode === 'team' ? '/app/team' : '/app/account')
}

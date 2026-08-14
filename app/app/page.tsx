import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

// App door — routes into the last-picked context: Team → the treasury terminal,
// otherwise the retail LP's Account (the Liquid Sovereign Account home). Mode is a
// soft cookie set by the Launch pick / scope switcher (Phase 1; Phase 2 will gate
// this with Privy RBAC).
export default async function AppHome() {
  const mode = (await cookies()).get('mw_app_mode')?.value
  redirect(mode === 'team' ? '/app/team' : '/app/account')
}

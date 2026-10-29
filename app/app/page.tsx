import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

// App door routes to the last-picked context. The marketing site's Open app CTA points to /v1.
export default async function AppHome() {
  const store = await cookies()
  const mode = store.get('mw_app_mode')?.value
  redirect(mode === 'team' ? '/app/team' : mode === 'rwa' && process.env.NEXT_PUBLIC_V2_RWA_ENABLED === 'true' ? '/app/rwa' : '/app/account')
}

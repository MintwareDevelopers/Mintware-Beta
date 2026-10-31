import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

// App door: the last-picked workspace. Every "Launch app" on the public site points to /app/markets.
export default async function AppHome() {
  const store = await cookies()
  redirect(store.get('mw_app_mode')?.value === 'team' ? '/app/team' : '/app/markets')
}

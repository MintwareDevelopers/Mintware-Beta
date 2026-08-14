'use client'

// AppMode — the User (Retail LP) ↔ Team (Treasury) context split. Phase 1 is a
// SOFT, client-side mode (no hard sign-in / middleware yet) so we can showcase both
// surfaces freely. Mode is derived from the route (/app/team/* = team, else user)
// and mirrored to a cookie so the /app server redirect + a returning visitor land
// in the last-picked context. Phase 2 will gate this with Privy RBAC + middleware.

import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export type AppMode = 'user' | 'team'

export const APP_MODE_COOKIE = 'mw_app_mode'
const USER_HOME = '/app/vaults'
const TEAM_HOME = '/app/team'

export function persistAppMode(mode: AppMode) {
  if (typeof document === 'undefined') return
  document.cookie = `${APP_MODE_COOKIE}=${mode};path=/;max-age=31536000;samesite=lax`
}

export function appModeHome(mode: AppMode) {
  return mode === 'team' ? TEAM_HOME : USER_HOME
}

type AppModeValue = { mode: AppMode; switchTo: (mode: AppMode) => void }

const AppModeContext = createContext<AppModeValue | null>(null)

export function AppModeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const mode: AppMode = pathname?.startsWith('/app/team') ? 'team' : 'user'

  const switchTo = useCallback(
    (next: AppMode) => {
      persistAppMode(next)
      router.push(appModeHome(next))
    },
    [router],
  )

  return <AppModeContext.Provider value={{ mode, switchTo }}>{children}</AppModeContext.Provider>
}

export function useAppMode(): AppModeValue {
  const ctx = useContext(AppModeContext)
  // Safe fallback so components outside /app (marketing) can call it harmlessly.
  if (!ctx) return { mode: 'user', switchTo: () => {} }
  return ctx
}

'use client'

// AppMode — which WORKSPACE of the app you are in: Personal (retail), Team (treasury) or RWA (the V2-RWAs
// partner vertical). Every workspace renders inside the same AppShell (sidebar + top bar); only the sidebar
// menu changes. Mode is derived from the route and mirrored to a cookie so the /app server redirect and a
// returning visitor land in the last-picked workspace. Still a SOFT split — hard gating is TEAM_HARD_GATE.

import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export type AppMode = 'user' | 'team' | 'rwa'

export const APP_MODE_COOKIE = 'mw_app_mode'
const HOMES: Record<AppMode, string> = { user: '/app/account', team: '/app/team', rwa: '/app/rwa' }

export function persistAppMode(mode: AppMode) {
  if (typeof document === 'undefined') return
  document.cookie = `${APP_MODE_COOKIE}=${mode};path=/;max-age=31536000;samesite=lax`
}

export function appModeHome(mode: AppMode) {
  return HOMES[mode] ?? HOMES.user
}

/** Route → workspace. /app/org/* is the real side of the Team workspace. */
export function modeForPath(pathname: string | null | undefined): AppMode {
  if (pathname?.startsWith('/app/rwa')) return 'rwa'
  if (pathname?.startsWith('/app/team') || pathname?.startsWith('/app/org')) return 'team'
  return 'user'
}

type AppModeValue = { mode: AppMode; switchTo: (mode: AppMode) => void }

const AppModeContext = createContext<AppModeValue | null>(null)

export function AppModeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const mode = modeForPath(pathname)

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

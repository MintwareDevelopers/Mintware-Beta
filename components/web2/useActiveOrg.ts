'use client'

// useActiveOrg — resolves the connected wallet's orgs + which one is "active" (last-used slug,
// else the first). One home for this lookup so the Team Terminal shell (nav routing) and
// TeamOrgBar (the banner) can't drift into disagreeing about which org you're in.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

export interface OrgRow {
  id: string
  name: string
  slug: string
  role: string
  isOwner: boolean
  funded: boolean
}

export const ACTIVE_ORG_KEY = 'mw_active_org_slug'

export function useActiveOrg(): { orgs: OrgRow[] | null; active: OrgRow | null } {
  const { address } = useMintwareIdentity()
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null)

  useEffect(() => {
    if (!address) { setOrgs(null); return }
    let alive = true
    fetch(`/api/orgs/mine?address=${address}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setOrgs((d.orgs as OrgRow[]) ?? []) })
      .catch(() => { if (alive) setOrgs([]) })
    return () => { alive = false }
  }, [address])

  // IA audit 2026-10-02: the key was read but never written, so a member of two orgs always got orgs[0] — the
  // sidebar and org bar showed org A while the page showed org B. The URL is the truth on /app/org/<slug>/*; it is
  // also remembered so the mock /app/team/* redirects and the workspace switcher land in the last-used org.
  const pathname = usePathname()
  const routeSlug = pathname?.match(/^\/app\/org\/([^/]+)/)?.[1] ?? null
  const fromRoute = routeSlug && routeSlug !== 'new' ? orgs?.find((o) => o.slug === routeSlug) ?? null : null
  useEffect(() => {
    if (fromRoute) { try { window.localStorage.setItem(ACTIVE_ORG_KEY, fromRoute.slug) } catch { /* storage blocked */ } }
  }, [fromRoute])
  let stored: string | null = null
  try { stored = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_ORG_KEY) : null } catch { stored = null }
  const active = fromRoute ?? orgs?.find((o) => o.slug === stored) ?? orgs?.[0] ?? null

  return { orgs, active }
}

// Once a wallet has an active org, the illustrative /app/team/* mock for that section is stale —
// send them to the real /app/org/[slug]/<subpath> page instead. Returns true while it's about to
// redirect (or has), so the caller can skip rendering its mock content for an instant.
export function useRedirectToActiveOrg(subpath: string): boolean {
  const router = useRouter()
  const { active } = useActiveOrg()

  useEffect(() => {
    if (active) router.replace(`/app/org/${active.slug}${subpath}`)
  }, [active, subpath, router])

  return !!active
}

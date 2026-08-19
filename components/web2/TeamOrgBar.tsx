'use client'

// TeamOrgBar — makes the team terminal ORG-AWARE. Resolves the connected wallet's real org(s)
// via /api/orgs/mine and surfaces the active one (name · role · treasury status) at the top of
// every team section, with the right next-step CTA. This is what turns "I'm a team" from an
// illustrative showcase into a real, tenant-scoped treasury terminal (roadmap P1). The rich
// KPIs/feeds below stay illustrative until a treasury is deployed + funded.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

interface OrgRow {
  id: string
  name: string
  slug: string
  role: string
  isOwner: boolean
  funded: boolean
}

const ACTIVE_KEY = 'mw_active_org_slug'

export function TeamOrgBar() {
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

  // Pick the active org: last-used slug if still present, else the first owned/joined org.
  const activeSlug = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_KEY) : null
  const active = orgs?.find((o) => o.slug === activeSlug) ?? orgs?.[0] ?? null

  // ── States ────────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <Bar tone="muted">
        <span className="text-ink-mid">Connect a wallet to load your organisation&apos;s treasury.</span>
      </Bar>
    )
  }

  if (orgs === null) {
    return <Bar tone="muted"><span className="text-ink-soft">Loading your org…</span></Bar>
  }

  if (orgs.length === 0) {
    return (
      <Bar tone="peri">
        <span className="min-w-0">
          <b className="text-ink">No treasury yet.</b>
          <span className="text-ink-mid"> Create an org to deploy a shared, earning treasury. Invited to one? Open the invite link you were sent.</span>
        </span>
        <Link href="/app/org/new" className="glass-pill glass-pill-sm glass-pill-primary no-underline shrink-0">Create org →</Link>
      </Bar>
    )
  }

  return (
    <Bar tone={active?.funded ? 'live' : 'peri'}>
      <span className="flex items-center gap-2.5 min-w-0">
        <span className="w-[26px] h-[26px] rounded-[8px] grid place-items-center text-white text-[13px] font-semibold shrink-0"
          style={{ background: 'linear-gradient(135deg,var(--color-peri-mid),var(--color-peri))' }}>
          {(active?.name ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <b className="text-ink text-[14px] truncate">{active?.name}</b>
            <span className="text-[10px] uppercase tracking-[0.06em] font-semibold rounded-full border border-hair bg-ground-cool px-2 py-0.5 text-ink-mid">
              {active?.isOwner ? 'Owner' : active?.role}
            </span>
            {active?.funded
              ? <span className="live-chip"><span className="dot" aria-hidden />Treasury live</span>
              : <span className="text-[10px] uppercase tracking-[0.06em] font-semibold rounded-full px-2 py-0.5 text-[#B4690E] bg-[rgba(196,122,0,0.1)]">No treasury yet</span>}
          </span>
          {orgs.length > 1 && (
            <Link href="/app/org" className="text-[11px] text-ink-soft hover:text-ink no-underline">+{orgs.length - 1} more org{orgs.length - 1 > 1 ? 's' : ''} →</Link>
          )}
        </span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {!active?.funded && active?.isOwner && (
          <Link href={`/app/org/${active.slug}/fund`} className="glass-pill glass-pill-sm glass-pill-primary no-underline">Set up treasury →</Link>
        )}
        <Link href={`/app/org/${active?.slug}`} className="glass-pill glass-pill-sm no-underline">Manage →</Link>
      </span>
    </Bar>
  )
}

function Bar({ tone, children }: { tone: 'muted' | 'peri' | 'live'; children: React.ReactNode }) {
  const border =
    tone === 'live' ? 'border-[rgba(22,163,74,0.3)]' : tone === 'peri' ? 'border-[rgba(108,108,240,0.3)]' : 'border-hair'
  return (
    <div className={`mb-5 rounded-[14px] border ${border} bg-white shadow-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap text-[13px]`}>
      {children}
    </div>
  )
}

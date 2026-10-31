'use client'

// TeamOrgBar — makes the team terminal ORG-AWARE. Resolves the connected wallet's real org(s)
// via /api/orgs/mine and surfaces the active one (name · role · treasury status) at the top of
// every team section, with the right next-step CTA. This is what turns "I'm a team" from an
// illustrative showcase into a real, tenant-scoped treasury terminal (roadmap P1). The rich
// KPIs/feeds below stay illustrative until a treasury is deployed + funded.

import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useActiveOrg } from '@/components/web2/useActiveOrg'
import Link from 'next/link'

export function TeamOrgBar() {
  const { address } = useMintwareIdentity()
  const { orgs, active } = useActiveOrg()

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
        <Link href="/app/org/new" className="mw-btn !min-h-[40px] shrink-0">Create org</Link>
      </Bar>
    )
  }

  return (
    <Bar tone={active?.funded ? 'live' : 'peri'}>
      <span className="flex items-center gap-2.5 min-w-0">
        <span className="w-9 h-9 rounded-[11px] grid place-items-center text-[15px] font-semibold shrink-0"
          style={{ background: 'linear-gradient(160deg,#FDE3D7,#F2B79C)', color: '#8A3A17', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.75)' }}>
          {(active?.name ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <b className="text-ink text-[15px] font-semibold truncate">{active?.name}</b>
            <span className="text-[11.5px] font-semibold rounded-full px-2 py-0.5 text-ink-mid" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
              {active?.isOwner ? 'Owner' : active?.role}
            </span>
            {/* Status in the material: solid = live, dotted = still being set up. */}
            {active?.funded
              ? <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold rounded-full px-2.5 py-0.5 bg-[#E3F4EA] text-[#0F7A43]"><span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" aria-hidden />Treasury live</span>
              : <span className="mw-tex-dots text-[11.5px] font-semibold rounded-full px-2.5 py-0.5 text-[#4B2FA0]" style={{ backgroundColor: '#EDE9FB' }}>No treasury yet</span>}
          </span>
          {orgs.length > 1 && (
            <Link href="/app/org" className="text-[12px] text-ink-soft hover:text-ink no-underline">+{orgs.length - 1} more org{orgs.length - 1 > 1 ? 's' : ''} →</Link>
          )}
        </span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {!active?.funded && active?.isOwner && (
          <Link href={`/app/org/${active.slug}`} className="mw-btn !min-h-[40px]">Open treasury</Link>
        )}
        <Link href={`/app/org/${active?.slug}`} className="mw-btn-quiet !min-h-[40px]">Manage</Link>
      </span>
    </Bar>
  )
}

function Bar({ tone, children }: { tone: 'muted' | 'peri' | 'live'; children: React.ReactNode }) {
  // Muted states (no wallet, loading) sit recessed; an org the wallet belongs to is a raised card you act on.
  const accent = tone === 'live' ? 'rgba(15,122,67,.28)' : tone === 'peri' ? 'rgba(91,91,230,.26)' : null
  return (
    <div
      className={`mb-6 rounded-[18px] px-4 py-3 flex items-center justify-between gap-3 flex-wrap text-[14px] ${accent ? 'mw-raise' : 'mw-inset'}`}
      style={accent ? { outline: `1.5px solid ${accent}`, outlineOffset: -1.5 } : undefined}
    >
      {children}
    </div>
  )
}

'use client'
// De-orphan a member: on the account page (where every user lands), surface the orgs this wallet belongs
// to + a one-click path to their card, so an invited cardholder is never stranded on revisit. Renders
// nothing for a wallet with no orgs — so a solo LP/swap user sees no org chrome (no bleed).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { policyForRole } from '@/lib/org/rolePresets'
import { StatusChip } from '@/components/web2/TeamKit'

type Org = { id: string; name: string; slug: string; role: string; isOwner: boolean; funded: boolean }

export function YourOrgs({ address }: { address?: string | null }) {
  const [orgs, setOrgs] = useState<Org[]>([])
  useEffect(() => {
    if (!address) { setOrgs([]); return }
    fetch(`/api/orgs/mine?address=${address}`).then((r) => r.json()).then((d) => {
      if (Array.isArray(d?.orgs)) setOrgs(d.orgs as Org[])
    }).catch(() => {})
  }, [address])

  if (orgs.length === 0) return null

  return (
    <section className="mt-10">
      <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft mb-3">Your organizations</div>
      <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3">
        {orgs.map((o) => {
          // Cards are pre-enable (Bridge + Stripe), so a member's next step is the org itself, not "your card".
          const cta = o.isOwner ? 'Manage treasury →' : 'Open org →'
          const roleLabel = o.isOwner ? 'Owner' : policyForRole(o.role).label
          return (
            <Link key={o.id} href={`/app/org/${o.slug}`} className="mw-raise mw-lift rounded-[20px] p-5 no-underline block">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-[16px] text-ink truncate">{o.name}</div>
                <StatusChip tone="muted">{roleLabel}</StatusChip>
              </div>
              <div className="mt-2">{o.funded ? <StatusChip tone="live">Treasury live</StatusChip> : <StatusChip tone="building">Setting up</StatusChip>}</div>
              <div className="text-[14px] font-semibold mt-3" style={{ color: 'var(--mw-peri-deep)' }}>{cta}</div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

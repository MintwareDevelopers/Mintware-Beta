'use client'
// De-orphan a member: on the account page (where every user lands), surface the orgs this wallet belongs
// to + a one-click path to their card, so an invited cardholder is never stranded on revisit. Renders
// nothing for a wallet with no orgs — so a solo LP/swap user sees no org chrome (no bleed).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { policyForRole } from '@/lib/org/rolePresets'

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
    <section className="max-w-[1040px] mx-auto px-6 max-sm:px-4 mt-8">
      <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft mb-3">Your organizations</div>
      <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3">
        {orgs.map((o) => {
          const receiveOnly = policyForRole(o.role).dailyCapUsdc === 0n
          const cta = o.isOwner ? 'Manage treasury →' : receiveOnly ? 'Open org →' : 'Go to your card →'
          const roleLabel = o.isOwner ? 'Owner' : policyForRole(o.role).label
          return (
            <Link key={o.id} href={`/app/org/${o.slug}`} className="soft-card p-4 no-underline group hover:shadow-card-hover transition-shadow block">
              <div className="flex items-center justify-between gap-2">
                <div className="font-atx-display font-semibold text-[15px] text-ink group-hover:text-peri-deep transition-colors truncate">{o.name}</div>
                <span className="text-[10px] uppercase tracking-[0.06em] font-semibold text-ink-soft rounded-full border border-hair px-2 py-0.5 shrink-0">{roleLabel}</span>
              </div>
              <div className="text-[12px] text-ink-soft mt-1">{o.funded ? 'Treasury live' : 'Setting up'}</div>
              <div className="text-[12.5px] font-semibold text-peri-deep mt-2.5">{cta}</div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

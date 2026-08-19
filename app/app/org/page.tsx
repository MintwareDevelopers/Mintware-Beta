'use client'

// /app/org — the org hub. Lists the orgs you own or belong to (via /api/orgs/mine) and a create CTA.
// This is the "select your org" surface the terminal's action buttons route into.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

interface OrgRow { id: string; name: string; slug: string; role: string; isOwner: boolean; funded: boolean }

export default function OrgHub() {
  const { address, isConnected } = useMintwareIdentity()
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null)

  const load = useCallback(() => {
    if (!address) { setOrgs([]); return }
    fetch(`/api/orgs/mine?address=${address}`).then((r) => r.json()).then((d) => setOrgs(d.orgs ?? [])).catch(() => setOrgs([]))
  }, [address])
  useEffect(() => { load() }, [load])

  return (
    <MwAuthGuard>
      <div className="min-h-screen font-atx-display bg-white text-ink">
        <MwNav />
        <main className="mx-auto max-w-[820px] px-6 max-[700px]:px-4 py-[48px]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Org treasuries</div>
              <h1 className="font-atx-display font-semibold text-[28px] tracking-[-0.03em] mt-1.5">Your orgs</h1>
            </div>
            <Link href="/app/org/new" className="shrink-0 rounded-full bg-peri text-white px-4 py-2.5 text-[13px] font-semibold no-underline hover:bg-peri-deep transition-colors">+ Create org</Link>
          </div>

          <div className="mt-7">
            {orgs === null && <div className="soft-card p-8 text-center text-[13px] text-ink-soft">Loading…</div>}
            {orgs && orgs.length === 0 && (
              <div className="soft-card p-8 text-center">
                <div className="text-[15px] font-semibold text-ink">{isConnected ? 'No orgs yet' : 'Connect a wallet'}</div>
                <p className="text-[13px] text-ink-mid mt-1.5 max-w-[46ch] mx-auto">{isConnected ? 'Create a treasury tenant — invite your team, record your vault, and start spending from an earning balance.' : 'Sign in to see the orgs you own or belong to.'}</p>
                {isConnected && <Link href="/app/org/new" className="mt-4 inline-block rounded-full bg-peri text-white px-5 py-2.5 text-[13.5px] font-semibold no-underline hover:bg-peri-deep transition-colors">Create your first org →</Link>}
              </div>
            )}
            {orgs && orgs.length > 0 && (
              <div className="soft-card overflow-hidden">
                {orgs.map((o) => (
                  <Link key={o.id} href={`/app/org/${o.slug}`} className="flex items-center gap-4 px-5 py-4 border-b border-hair-soft last:border-0 no-underline hover:bg-ground-cool transition-colors">
                    <div className="w-[38px] h-[38px] rounded-[10px] bg-peri/10 grid place-items-center text-peri-deep font-semibold text-[15px] shrink-0">{o.name.slice(0, 1).toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14.5px] font-medium text-ink truncate">{o.name}</div>
                      <div className="text-[11.5px] text-ink-soft">/org/{o.slug} · {o.isOwner ? 'Owner' : o.role}{!o.funded ? ' · treasury not set' : ''}</div>
                    </div>
                    <span className="text-peri-deep text-[15px]">→</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </MwAuthGuard>
  )
}

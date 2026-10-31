'use client'

// /app/org — the org hub. Lists the orgs you own or belong to (via /api/orgs/mine) and a create CTA.
// This is the "select your org" surface the terminal's action buttons route into. Chrome comes from
// the shared TeamTerminalShell layout (app/app/org/(guarded)/layout.tsx) — same shell as /app/team/*.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHead, IconTile, IconOrg, StatusChip } from '@/components/web2/TeamKit'
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
      <div className="max-w-[820px] mx-auto">
        <PageHead
          icon={<IconOrg size={24} />}
          title="Your orgs"
          lede="The treasuries you own or belong to. Pick one to open it."
          actions={<Link href="/app/org/new" className="mw-btn !min-h-[40px]">+ Create org</Link>}
        />

        <div className="mt-7">
          {orgs === null && <div className="mw-inset rounded-[22px] p-8 text-center text-[14px] text-ink-soft">Loading…</div>}
          {orgs && orgs.length === 0 && (
            <div className="mw-raise rounded-[24px] p-8 text-center">
              <div className="mx-auto w-fit"><IconTile><IconOrg /></IconTile></div>
              <div className="text-[17px] font-semibold text-ink mt-4">{isConnected ? 'No orgs yet' : 'Connect a wallet'}</div>
              <p className="text-[14px] text-ink-mid mt-1.5 max-w-[46ch] mx-auto">{isConnected ? 'Create a treasury for your team: invite members, set their roles, and record payments in one ledger.' : 'Sign in to see the orgs you own or belong to.'}</p>
              {isConnected && <Link href="/app/org/new" className="mt-5 mw-btn !min-h-[44px]">Create your first org</Link>}
            </div>
          )}
          {orgs && orgs.length > 0 && (
            <div className="flex flex-col gap-3">
              {orgs.map((o) => (
                <Link key={o.id} href={`/app/org/${o.slug}`} className="mw-raise mw-lift rounded-[20px] flex items-center gap-4 px-5 py-4 no-underline">
                  <div className="w-11 h-11 rounded-[12px] grid place-items-center font-semibold text-[16px] shrink-0" style={{ background: 'linear-gradient(160deg,#FDE3D7,#F2B79C)', color: '#8A3A17', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.75)' }}>{o.name.slice(0, 1).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[16px] font-semibold text-ink truncate">{o.name}</div>
                    <div className="text-[12.5px] text-ink-soft mt-0.5"><span className="font-geist-mono">/org/{o.slug}</span> · {o.isOwner ? 'Owner' : o.role}</div>
                  </div>
                  <span className="max-[480px]:hidden">{o.funded ? <StatusChip tone="live">Treasury live</StatusChip> : <StatusChip tone="building">Setting up</StatusChip>}</span>
                  <span className="text-[18px]" style={{ color: 'var(--mw-peri-deep)' }} aria-hidden>→</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </MwAuthGuard>
  )
}

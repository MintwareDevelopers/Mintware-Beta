'use client'

// Team · Team & Roles — design-forward. Member roster + the role ladder
// (Admin → Signer → Approver → Member → Viewer) converged on across Fireblocks /
// Prime / Safe. Role-scoped visibility: members see only their own cards. ALL
// illustrative — the org/RBAC layer is Phase 2 (Privy metadata + middleware).
//
// Once a wallet has an active org, this mock is stale — it redirects to the real
// /app/org/[slug]/roles roster instead.

import Link from 'next/link'
import { useRedirectToActiveOrg } from '@/components/web2/useActiveOrg'
import { PageHead, SLabel, StatusChip, Note, IconPeople } from '@/components/web2/TeamKit'

type Role = 'Admin' | 'Signer' | 'Approver' | 'Member' | 'Viewer'

const MEMBERS: { name: string; email: string; role: Role; cards: number; last: string }[] = [
  { name: 'Devon R.', email: 'devon@acme.xyz', role: 'Admin',    cards: 1, last: '2h ago' },
  { name: 'Priya S.', email: 'priya@acme.xyz', role: 'Signer',   cards: 1, last: '1h ago' },
  { name: 'Marco L.', email: 'marco@acme.xyz', role: 'Approver', cards: 1, last: '30m ago' },
  { name: 'Jenny K.', email: 'jenny@acme.xyz', role: 'Member',   cards: 1, last: '1d ago' },
  { name: 'Auditor',  email: 'audit@acme.xyz', role: 'Viewer',   cards: 0, last: 'Aug 10' },
]

const LADDER: { role: Role; can: string }[] = [
  { role: 'Admin',    can: 'Full control — invite/remove members, set the threshold, adjust vault allocation, export audit logs.' },
  { role: 'Signer',   can: 'Signs treasury moves toward the quorum; holds a key share.' },
  { role: 'Approver', can: 'Approves actions; no key share, no signing.' },
  { role: 'Member',   can: 'Proposes actions and spends within their own card limits; sees only their own cards.' },
  { role: 'Viewer',   can: 'Read-only — for accountants and auditors.' },
]

export default function TeamRoles() {
  const redirecting = useRedirectToActiveOrg('/roles')
  if (redirecting) return null

  return (
    <>
      <PageHead
        icon={<IconPeople size={24} />}
        title="Team & roles"
        status={{ tone: 'preview', label: 'Preview · illustrative' }}
        lede="Invite your team and scope what each person can do, from full admin down to read-only. Members see only their own cards and activity; admins see the whole treasury."
        actions={<Link href="/app/org" className="mw-btn !min-h-[40px]">+ Invite</Link>}
      />

      {/* Roster */}
      <SLabel>Members · {MEMBERS.length}</SLabel>
      <div className="mw-raise rounded-[22px] overflow-hidden">
        {MEMBERS.map((m) => (
          <div key={m.email} className="flex items-center gap-4 px-5 py-4 border-b border-[rgba(21,21,29,.06)] last:border-0">
            <span className="w-10 h-10 rounded-full grid place-items-center text-[12px] font-semibold shrink-0" style={{ background: 'var(--mw-sheen)', color: '#2E2BA8', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)' }}>{m.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[15px] text-ink truncate">{m.name}</div>
              <div className="text-[12.5px] text-ink-soft truncate">{m.email}</div>
            </div>
            <StatusChip tone={m.role === 'Admin' ? 'live' : 'muted'}>{m.role}</StatusChip>
            <span className="text-[12.5px] text-ink-soft w-[64px] text-right shrink-0 max-[560px]:hidden">{m.last}</span>
          </div>
        ))}
      </div>

      {/* Role ladder — most power at the top, drawn as a stack that narrows toward read-only */}
      <SLabel>The role ladder</SLabel>
      <ol className="m-0 p-0 list-none flex flex-col gap-2 max-w-[780px]">
        {LADDER.map((r, k) => (
          <li key={r.role} className="mw-raise-sm rounded-[18px] px-5 py-3.5 flex items-start gap-4" style={{ marginRight: `${k * 4}%` }}>
            <span className="font-semibold text-[14.5px] w-[84px] shrink-0">{r.role}</span>
            <span className="text-[14px] text-ink-mid leading-[1.5]">{r.can}</span>
          </li>
        ))}
      </ol>

      <Note>Illustrative. In a real org you pick from four fixed presets (owner, manager, contributor, vendor); manage them under <Link href="/app/org" className="font-semibold no-underline" style={{ color: 'var(--mw-peri-deep)' }}>your org</Link>. Nothing here is live.</Note>
    </>
  )
}

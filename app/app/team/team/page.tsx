// Team · Team & Roles — design-forward. Member roster + the role ladder
// (Admin → Signer → Approver → Member → Viewer) converged on across Fireblocks /
// Prime / Safe. Role-scoped visibility: members see only their own cards. ALL
// illustrative — the org/RBAC layer is Phase 2 (Privy metadata + middleware).

type Role = 'Admin' | 'Signer' | 'Approver' | 'Member' | 'Viewer'
const ROLE_CLS: Record<Role, string> = {
  Admin:    'text-peri-deep',
  Signer:   'text-coral2-deep',
  Approver: 'text-ink',
  Member:   'text-ink-mid',
  Viewer:   'text-ink-soft',
}

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
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-atx-display font-semibold text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">Team & Roles</h1>
          <span className="live-chip"><span className="dot" aria-hidden />Preview · illustrative</span>
        </div>
        <button className="glass-pill glass-pill-sm" disabled title="Coming soon">+ Invite</button>
      </div>
      <p className="text-ink-mid text-[14px] leading-[1.55] max-w-[64ch] mt-2.5">Invite your team and scope what each person can do — from full admin down to read-only. Members see only their own cards and activity; admins see the whole treasury.</p>

      {/* Roster */}
      <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-6 mb-3">Members · {MEMBERS.length}</div>
      <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-x-auto">
        <table className="w-full min-w-[560px] max-[640px]:min-w-0 border-collapse text-[13px]">
          <thead>
            <tr className="bg-ground-cool border-b border-hair-soft">
              {['Member', 'Role', 'Cards', 'Last active'].map((h, i) => (
                <th key={h} className={`text-[9.5px] uppercase tracking-[0.09em] font-semibold text-ink-soft px-4 py-2.5 text-left ${i === 2 ? 'text-right max-[520px]:hidden' : ''} ${i === 3 ? 'max-[640px]:hidden' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MEMBERS.map((m) => (
              <tr key={m.email} className="border-b border-hair-soft last:border-0 hover:bg-ground-cool transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-[26px] h-[26px] rounded-full grid place-items-center text-[9px] font-semibold text-white shrink-0" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))' }}>{m.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{m.name}</div>
                      <div className="text-[11px] text-ink-soft truncate">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><span className={`text-[10px] uppercase tracking-[0.06em] font-semibold rounded-full border border-hair bg-ground-cool px-2 py-1 ${ROLE_CLS[m.role]}`}>{m.role}</span></td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-mid max-[520px]:hidden">{m.cards}</td>
                <td className="px-4 py-3 text-ink-soft max-[640px]:hidden">{m.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Role ladder */}
      <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">The role ladder</div>
      <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card divide-y divide-hair-soft max-w-[760px]">
        {LADDER.map((r) => (
          <div key={r.role} className="flex items-start gap-4 px-5 py-3.5">
            <span className={`text-[11px] uppercase tracking-[0.06em] font-semibold w-[84px] shrink-0 ${ROLE_CLS[r.role]}`}>{r.role}</span>
            <span className="text-[13.5px] text-ink-mid leading-[1.5]">{r.can}</span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-ink-soft mt-5">Illustrative. Role and org membership will be carried in the Privy session — the hard gate lands in Phase 2. Nothing here is live.</p>
    </>
  )
}

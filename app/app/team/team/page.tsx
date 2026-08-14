import { TeamStub } from '@/components/web2/team/TeamStub'

export default function TeamRoles() {
  return (
    <TeamStub
      title="Team & Roles"
      blurb="Invite your team and scope what each person can do. A standard role ladder — from full admin down to read-only — with visibility scoped to the cards and wallets each member owns."
      coming={[
        'Roles: Admin → Signer → Approver → Initiator → Viewer/auditor, with per-area permission toggles',
        'Invite by email; role and org membership carried in the Privy session (the Phase-2 hard-gate)',
        'Role-scoped visibility — members see only their own cards and activity; admins see the whole treasury',
        'Audit log export for finance and compliance',
      ]}
    />
  )
}

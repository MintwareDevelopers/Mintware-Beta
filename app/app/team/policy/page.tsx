import { TeamStub } from '@/components/web2/team/TeamStub'

export default function TeamPolicy() {
  return (
    <TeamStub
      title="Policy & Approvals"
      blurb="Spend policy and m-of-n approvals for treasury moves — the guardrails a finance team needs, enforced on-chain. Small everyday spend flows under a limit; larger moves collect signatures before they execute."
      coming={[
        'M-of-n quorum on treasury actions (e.g. 2-of-3), shown as a headline stat with a pending queue — “1 of 2 signed” per row',
        'Spending limits below the quorum — per-member, per-token, time-boxed, whitelisted destinations (the “petty cash” pattern)',
        'Rules by amount / category / destination; the outcome predicted before you submit (approved · needs another signer)',
        'Governance changes (add a signer, change the threshold) themselves flow through the approval queue',
      ]}
    />
  )
}

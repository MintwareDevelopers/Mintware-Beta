import { TeamStub } from '@/components/web2/team/TeamStub'

export default function TeamCards() {
  return (
    <TeamStub
      title="Cards & Spend"
      blurb="Issue virtual and physical cards backed by treasury liquidity. Spend against your on-chain NAV — a credit line, not a debit balance — so capital keeps earning right up until the moment it settles."
      coming={[
        'Card directory grouped by member — issue virtual cards in seconds, set per-card and per-member limits (daily / weekly / monthly)',
        'Merchant allow / block controls enforced as pre-authorization guardrails',
        'A spend feed with status sub-tabs (needs review · flagged · approved · declined), receipts auto-matched',
        'Every authorization decided by the sub-150ms edge-auth engine and settled on-chain, verifiable on a block explorer',
      ]}
    />
  )
}

import { TeamStub } from '@/components/web2/team/TeamStub'

export default function TeamDevelopers() {
  return (
    <TeamStub
      title="Developers"
      blurb="Wire the treasury into your own systems. API keys, webhooks for authorization and settlement events, and role-based access so automation runs under the same policy as people."
      coming={[
        'API keys with scoped permissions',
        'Webhooks for authorization, settlement, and policy events',
        'Sandbox against Base Sepolia before mainnet',
        'SDK + reference for the spend-permit and settlement flow',
      ]}
    />
  )
}

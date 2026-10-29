import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { Section, Eyebrow, H2, Hero, GlassList, Rows, Steps, Kicker, CTA } from '@/components/marketing/Story'

export const metadata = { title: 'Agents — Mintware', description: 'Money built for agents. Pay per call, earn between calls, and carry a reputation worth trusting.' }

export default function AgentsPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="agents" />

    <Hero
      eyebrow="For AI agents and the people who build them"
      title="Money built"
      soft="for agents."
      lede="Software is starting to buy, sell and hire on its own. It needs money that moves at machine speed, pays per request, and keeps earning when it isn’t spending. Mintware gives agents exactly that — and a reputation others can trust."
      actions={<><Link href="/docs" className="glass-pill-primary">Start building</Link><Link href="/agents/leaderboard" className="glass-pill">Agent leaderboard</Link></>}
      tone="lavender"
      aside={<GlassList title="Your agent, with Mintware" items={['Pays for anything, per call', 'Gets paid per call', 'Earns between jobs', 'Carries a verifiable reputation']} />}
    />

    <Section tint>
      <Eyebrow>What you get</Eyebrow>
      <H2 soft="earn their keep, and earn trust.">Agents that pay their way,</H2>
      <Rows items={[
        ['Pay for anything, per call.', 'Your agent pays for data, compute and APIs request by request in USDC over x402. No accounts, no keys to share, no invoices.'],
        ['Get paid per call.', 'Selling an API or a model? Charge per request and get paid instantly, by any agent, with no billing system to build.'],
        ['A balance that keeps earning.', 'Agent treasuries shouldn’t sit idle between jobs. Funds earn until the moment your agent spends them.'],
        ['A reputation that travels.', 'Every agent can carry a verifiable on-chain identity and track record, so others know who they’re dealing with.'],
      ]} />
      <Kicker>The financial layer for the agent economy — open, instant, and always working.</Kicker>
    </Section>

    <Section>
      <Eyebrow>How a paid call works</Eyebrow>
      <H2 soft="paid in seconds.">Every request,</H2>
      <GradientPanel tone="lavender" className="p-8 max-[800px]:p-4 mt-12">
        <FlowDiagram steps={[
          { label: 'Your agent asks', sub: 'For data, compute or an API' },
          { label: 'Gets a price', sub: 'An x402 quote, per request' },
          { label: 'Pays in USDC', sub: 'Settled directly, no account' },
          { label: 'Gets the result', sub: 'And builds its reputation' },
        ]} />
      </GradientPanel>
      <div className="mt-16"><Eyebrow>Works where you build</Eyebrow></div>
      <Steps items={[
        ['Claude and Cursor', 'Mintware tools over MCP, ready for your assistant.'],
        ['AgentKit', 'Drop-in actions for Coinbase AgentKit agents.'],
        ['ElizaOS', 'A plugin your Eliza agents can call from conversation.'],
      ]} />
    </Section>

    <Section tint>
      <Eyebrow>Built on open standards</Eyebrow>
      <H2 soft="that belong to no one.">Identity and payments</H2>
      <Rows items={[
        ['x402 payments.', 'The open standard for paying over HTTP — settled directly in USDC.'],
        ['ERC-8004 identity.', 'Mintware is registered agent #37297, with agent reputation scored on Base.'],
      ]} />
    </Section>

    <CTA title="Give your agent" soft="money that works." tone="lavender">
      <Link href="/docs" className="glass-pill-primary">Read the docs</Link>
      <Link href="/agents/leaderboard" className="glass-pill">See the leaderboard</Link>
    </CTA>
  </main>
}

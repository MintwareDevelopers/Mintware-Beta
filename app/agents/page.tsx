import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { Section, Eyebrow, H1, H2, Kicker, Steps, Rows, wrap, body } from '@/components/marketing/Story'

export const metadata = { title: 'Agents — Mintware', description: 'Money built for agents. Pay per call, earn between calls, and carry a reputation worth trusting.' }

export default function AgentsPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="agents" />

    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <Eyebrow>For AI agents and the people who build them</Eyebrow>
        <H1>Money built for agents.</H1>
        <p className={`${body} mt-6`}>Software is starting to buy, sell and hire on its own. It needs money that moves at machine speed, pays per request, and keeps earning when it isn’t spending. Mintware gives agents exactly that — and a reputation others can trust.</p>
        <div className="flex flex-wrap gap-3 mt-8"><Link href="/docs" className="glass-pill-primary">Start building</Link><Link href="/agents/leaderboard" className="glass-pill">Agent leaderboard</Link></div>
      </div>
    </section>

    <Section>
      <Eyebrow>What you get</Eyebrow>
      <H2>Agents that pay their way, earn their keep, and earn trust.</H2>
      <Rows items={[
        ['Pay for anything, per call.', 'Your agent pays for data, compute and APIs request by request in USDC over x402. No accounts to open, no keys to share, no invoices.'],
        ['Get paid per call.', 'Selling an API or a model? Charge per request and get paid instantly, by any agent, with no billing system to build.'],
        ['A balance that keeps earning.', 'Agent treasuries shouldn’t sit idle between jobs. Funds earn until the moment your agent spends them.'],
        ['A reputation that travels.', 'Every agent can carry a verifiable on-chain identity and track record, so others know who they’re dealing with.'],
      ]} />
      <Kicker>The financial layer for the agent economy — open, instant, and always working.</Kicker>
    </Section>

    <Section tint>
      <Eyebrow>Works where you build</Eyebrow>
      <H2>Plug in, in minutes.</H2>
      <Steps items={[
        ['Claude and Cursor', 'Mintware tools over MCP, ready for your assistant.'],
        ['AgentKit', 'Drop-in actions for Coinbase AgentKit agents.'],
        ['ElizaOS', 'A plugin your Eliza agents can call from conversation.'],
      ]} />
    </Section>

    <Section>
      <Eyebrow>Built on open standards</Eyebrow>
      <H2>Identity and payments that belong to no one.</H2>
      <Rows items={[
        ['x402 payments.', 'The open standard for paying over HTTP — settled directly in USDC.'],
        ['ERC-8004 identity.', 'Mintware is registered agent #37297, with agent reputation scored on Base.'],
      ]} />
      <div className="flex flex-wrap gap-3 mt-10"><Link href="/docs" className="glass-pill-primary">Read the docs</Link><Link href="/agents/leaderboard" className="glass-pill">See the leaderboard</Link></div>
    </Section>
  </main>
}

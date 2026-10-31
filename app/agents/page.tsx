import Link from 'next/link'
import type { ReactNode } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'
import { AgentExchange } from '@/components/marketing/mineral/AgentExchange'
import { Page, Section, SectionHead, Hero, IconTile, Arrow, CTA, wrap } from '@/components/marketing/Story'
import { IconTrade, IconOwned, IconPrice, IconHolders, IconCurated, IconHours } from '@/components/ui2/MineralIcons'

export const metadata = { title: 'Agents — Mintware', description: 'Money built for agents. Pay per request, get paid per request, and carry an identity others can check.' }

// The page argues: agents need to pay and get paid per request → here is both sides of that, in plain steps →
// it plugs into the tools you already build with → identity others can check → what's live today, honestly.

const SIDES: { title: string; who: string; icon: ReactNode; steps: [string, string][] }[] = [
  {
    title: 'Your agent pays', who: 'Buying data, compute or an API', icon: <IconTrade key="t" size={22} />,
    steps: [
      ['It asks', 'A normal HTTP request to any x402 endpoint.'],
      ['It sees the price', 'The API answers 402 with an amount in USDC.'],
      ['It pays and retries', 'A signed USDC transfer from the agent’s own wallet rides along with the retry.'],
    ],
  },
  {
    title: 'Your API gets paid', who: 'Selling an API, a model or data', icon: <IconPrice key="p" size={22} />,
    steps: [
      ['Name a price', 'Put a per-request price on an endpoint.'],
      ['Verify the payment', 'Check the signed transfer before you do the work.'],
      ['Settle in USDC', 'It lands in your wallet. No billing system, no invoices.'],
    ],
  },
]

const TOOLS: [string, string, string][] = [
  ['Claude & Cursor', 'Mintware tools over MCP, for your assistant.', '@mintwarehq/mcp-server'],
  ['Coinbase AgentKit', 'Drop-in actions for AgentKit agents.', '@mintwarehq/agentkit-actions'],
  ['ElizaOS', 'A plugin your Eliza agents can call from conversation.', '@mintwarehq/eliza-plugin'],
]

// Status carried in the material, as on the landing: solid = live, dotted = building, hatched = planned.
const STATUS: { t: string; d: string; tex: 'solid' | 'dots' | 'hatch'; label: string }[] = [
  { t: 'Pay and get paid per request', d: 'x402 payments in USDC, settled straight to the seller. Mintware’s own score API is paid this way.', tex: 'solid', label: 'Live' },
  { t: 'On-chain agent identity', d: 'ERC-8004 registration on Base. Mintware is agent #37297.', tex: 'solid', label: 'Live' },
  { t: 'Agent reputation', d: 'A track record built from how an agent actually pays and behaves.', tex: 'dots', label: 'Building' },
  { t: 'Earning between jobs', d: 'An agent balance that earns until it’s spent. Today’s parking account is testnet and does not earn yet.', tex: 'hatch', label: 'Planned' },
]
const TEX = {
  solid: { card: 'mw-raise', bar: '', bg: '#7C7AF0', chip: 'bg-[#E3F4EA] text-[#0F7A43]' },
  dots: { card: 'mw-raise-sm', bar: 'mw-tex-dots', bg: '#E1DBFA', chip: 'bg-[#EDE9FB] text-[#4B2FA0]' },
  hatch: { card: 'mw-inset', bar: 'mw-tex-hatch', bg: '#ECECF2', chip: 'bg-white text-ink-mid' },
}

export default function AgentsPage() {
  return <Page>
    <V2Nav active="agents" />

    <Hero
      eyebrow="For AI agents and the people who build them"
      title="Money built"
      soft="for agents."
      lede="Software is starting to buy and sell on its own. Mintware lets an agent pay for what it uses one request at a time, charge for what it sells the same way, and carry an identity others can check."
      actions={<><Link href="/docs" className="mw-btn mw-btn-lg">Start building <Arrow /></Link><a href="#how" className="mw-btn-quiet mw-btn-lg">How a paid call works</a></>}
      aside={<AgentExchange />}
    />

    {/* 1 — both sides of a paid call */}
    <Section id="how" tint>
      <SectionHead
        eyebrow="How a paid call works"
        title="Pay per request."
        soft="Get paid the same way."
        aside="x402 puts payment inside HTTP itself. No accounts to open, no keys to share, no monthly invoice. The same handshake works from either side."
      />
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {SIDES.map((s) => (
          <div key={s.title} className="mw-raise rounded-[26px] p-[clamp(22px,3vw,32px)]">
            <div className="flex items-center gap-3.5"><IconTile>{s.icon}</IconTile><div><div className="font-semibold text-[20px] tracking-[-0.02em]">{s.title}</div><div className="text-[14px] text-ink-soft">{s.who}</div></div></div>
            <ol className="mt-6 p-0 list-none flex flex-col gap-3">
              {s.steps.map(([t, d], i) => (
                <li key={t} className="flex gap-3.5 rounded-[16px] px-4 py-3.5" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                  <span className="flex-none w-7 h-7 rounded-full grid place-items-center text-[13px] font-semibold text-white" style={{ background: 'var(--mw-btn)' }}>{i + 1}</span>
                  <div><div className="font-semibold text-[15px]">{t}</div><div className="text-[14px] text-ink-mid leading-[1.5] mt-0.5">{d}</div></div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </Section>

    {/* 2 — where you build */}
    <Section>
      <SectionHead
        eyebrow="Works where you build"
        title="Drop it into"
        soft="the agent you already have."
        aside="Park, pay and quote actions for the three most common agent runtimes. Same actions, same behaviour, whichever you use."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {TOOLS.map(([t, d, pkg]) => (
          <div key={t} className="mw-raise mw-lift rounded-[24px] p-6 flex flex-col">
            <div className="font-semibold text-[19px] tracking-[-0.02em]">{t}</div>
            <div className="text-[14.5px] text-ink-mid leading-[1.5] mt-1.5">{d}</div>
            <div className="mt-auto pt-5"><code className="block font-geist-mono text-[12.5px] rounded-[12px] px-3.5 py-2.5 truncate" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)', color: 'var(--mw-peri-deep)' }}>{pkg}</code></div>
          </div>
        ))}
      </div>
    </Section>

    {/* 3 — identity */}
    <section style={{ background: 'var(--mw-band)', borderTop: '1px solid var(--mw-line)', borderBottom: '1px solid var(--mw-line)' }}>
      <div className={`${wrap} py-[clamp(64px,8vw,120px)] grid lg:grid-cols-[1fr_1fr] gap-12 items-center`}>
        <div>
          <SectionHead eyebrow="Identity" title="Know who" soft="you’re dealing with." />
          <p className="mt-6 mb-0 text-[17px] leading-[1.6] text-ink-mid max-w-[50ch]">When software pays software, “who is this?” matters. Agents can register an on-chain identity under ERC-8004, the open standard for agent identity, so anyone can look up who they are and how they’ve behaved.</p>
          <Link href="/agents/leaderboard" className="mw-btn-quiet mt-8">See the agent leaderboard <Arrow size={16} /></Link>
        </div>
        <div className="relative">
          <div aria-hidden="true" className="absolute inset-[12%_-6%_-6%_8%] rounded-[40px] opacity-30 blur-[48px]" style={{ background: 'var(--mw-sheen)' }} />
          <div className="mw-raise-lg relative rounded-[26px] p-6 max-w-[440px] mx-auto">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-full grid place-items-center" style={{ background: 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', boxShadow: 'inset 0 1px 0 #fff', color: '#2E2BA8' }}><IconHolders size={22} /></span>
                <span><span className="block font-semibold text-[17px]">Mintware</span><span className="block text-[13px] text-ink-soft">Registered agent</span></span>
              </span>
              <span className="font-geist-mono text-[20px] tracking-[-0.02em]">#37297</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5 text-[13px]">
              {([['Standard', 'ERC-8004', <IconCurated key="c" size={16} />], ['Chain', 'Base', <IconOwned key="o" size={16} />], ['Paid via', 'x402, USDC', <IconTrade key="t" size={16} />], ['Registered', 'March 2026', <IconHours key="h" size={16} />]] as [string, string, ReactNode][]).map(([k, v, icon]) => (
                <div key={k} className="rounded-[16px] p-4" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                  <div className="flex items-center gap-1.5 text-ink-soft"><span style={{ color: 'var(--mw-peri-deep)' }}>{icon}</span>{k}</div>
                  <div className="font-semibold text-[16px] mt-1.5">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* 4 — honest status */}
    <Section>
      <SectionHead
        eyebrow="What’s live"
        title="Live today,"
        soft="and what’s next."
        aside="Solid is live, dotted is being built, hatched is planned. No part of this is audited yet; agent balances run on testnet."
      />
      <div className="mt-12 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))] items-stretch">
        {STATUS.map((s) => (
          <div key={s.t} className={`${TEX[s.tex].card} rounded-[22px] p-6 flex flex-col`}>
            <div className={`h-2 rounded-full ${TEX[s.tex].bar}`} style={{ backgroundColor: TEX[s.tex].bg }} aria-hidden="true" />
            <span className={`self-start mt-5 inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full ${TEX[s.tex].chip}`}>{s.tex === 'solid' && <span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" />}{s.label}</span>
            <div className="font-semibold text-[18px] tracking-[-0.02em] mt-4">{s.t}</div>
            <div className="text-[14.5px] text-ink-mid leading-[1.5] mt-1.5">{s.d}</div>
          </div>
        ))}
      </div>
    </Section>

    <CTA title="Give your agent" soft="a way to pay.">
      <Link href="/docs" className="mw-btn mw-btn-lg">Read the docs <Arrow /></Link>
      <Link href="/agents/leaderboard" className="mw-btn-quiet mw-btn-lg">See the leaderboard</Link>
    </CTA>
  </Page>
}

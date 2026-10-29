import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { DiscoverMarkets } from '@/components/marketing/DiscoverMarkets'
import { PositionCard } from '@/components/marketing/PositionCard'
import { Section, Eyebrow, H2, P, Hero, Rows, Steps, Stats, Kicker, CTA, wrap } from '@/components/marketing/Story'

const SHIFT: [string, string][] = [
  ['$300B+', 'in stablecoins — the internet’s dollars, mostly sitting still.'],
  ['$38B+', 'in tokenized real-world assets on-chain, up ~66% this year.'],
  ['3×', 'growth in tokenized stocks in 2026, from under $1B to over $3B.'],
  ['~2,000', 'stock tokens issued by Robinhood. 3 in 4 dollars on Robinhood Chain are equities.'],
]

const PRODUCTS: [string, string, string, string][] = [
  ['Markets', 'Earn what market makers earn.', 'Back the markets for tokenized stocks, RWAs and stablecoins you believe in.', '/markets'],
  ['Earn', 'Your dollars, working.', 'Stablecoins that earn every second and stay yours to take back.', '/earn'],
  ['Card', 'Spend what you’ve earned.', 'A card that refills itself while the rest keeps working.', '/cards'],
  ['Issuers', 'Your token. Our liquidity.', 'Deep, fair markets for your asset from day one.', '/issuers'],
  ['Agents', 'Money built for agents.', 'Pay per call, earn between calls, carry a reputation.', '/agents'],
  ['Curation', 'Only markets worth backing.', 'Every market reviewed before it opens.', '/markets'],
]

const MILESTONES: [string, string][] = [
  ['Oct 2026', 'Market engine live on Robinhood Chain'],
  ['Oct 2026', 'First deposits and withdrawals through mintware.finance'],
  ['Live', 'Discover tracking Robinhood Chain markets in real time'],
]

export default function HomePage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav />

    <Hero
      eyebrow="The liquidity layer for on-chain value"
      title="Every asset deserves"
      soft="a market."
      lede="Stocks, treasuries, property and dollars are being rebuilt as tokens — global, programmable, open around the clock. Mintware gives them deep, fair markets, built from capital that earns when markets are quiet, deepens them when they’re busy, and is yours to take back the moment you want it."
      actions={<><Link href="/v1" className="glass-pill-primary">Open the app</Link><Link href="/issuers#talk" className="glass-pill">Bring your asset to market</Link></>}
      aside={<PositionCard />}
    />

    <Section tint>
      <Eyebrow>The shift is already here</Eyebrow>
      <H2 soft="The markets haven’t.">The assets have arrived.</H2>
      <Stats items={SHIFT} />
      <P>Tesla, Nvidia, Apple and thousands more now exist as tokens, and the largest issuers are bringing them to Robinhood Chain with on-chain pools of their own. Treasuries, credit and real estate are following.</P>
    </Section>

    <Section>
      <Eyebrow>The bottleneck nobody solved</Eyebrow>
      <H2 soft="Liquidity is hard.">Tokenizing is easy.</H2>
      <Rows items={[
        ['Thin markets, unfair prices.', 'Most tokens launch into shallow pools with wide spreads, where a modest trade moves the price. Buyers stay away.'],
        ['Rented depth.', 'Issuers pay market makers to fake depth — and that liquidity leaves the day the contract ends.'],
        ['Liquidity in the wrong places.', 'With no better home, a sixth of on-chain stock-token supply sits in memecoin pools.'],
        ['Idle capital on the sidelines.', 'Providing liquidity has meant locking money up to earn, or keeping it free and earning nothing. Most people choose free.'],
      ]} />
    </Section>

    <Section tint>
      <Eyebrow>The breakthrough</Eyebrow>
      <H2 soft="and never locks you in.">Liquidity that never sits idle —</H2>
      <Steps items={[
        ['When the market is busy', 'Your capital is in the pool — deepening the market and earning on every trade.'],
        ['When it’s quiet', 'What the market doesn’t need moves into yield and keeps earning.'],
        ['When you want out', 'You leave instantly, with your share of both assets. No queue, no lockup.'],
      ]} />
      <Kicker>For the first time, the most liquid choice and the most productive choice are the same choice.</Kicker>
      <div className="mt-10 flex flex-wrap items-center gap-4"><DiscoverMarkets mode="top" /><Link className="text-[14px] font-semibold text-peri-deep no-underline hover:underline" href="/markets">See all markets →</Link></div>
    </Section>

    <Section>
      <Eyebrow>One engine, a whole financial life</Eyebrow>
      <H2 soft="every dollar working.">Every asset with a market,</H2>
      <div className="grid md:grid-cols-3 gap-5 mt-12">
        {PRODUCTS.map(([name, title, d, href]) => <Link key={name} href={href} className="soft-card p-8 no-underline text-ink flex flex-col min-h-[230px]">
          <span className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-peri-deep">{name}</span>
          <span className="font-atx-display font-medium text-[1.6rem] tracking-[-0.025em] leading-[1.15] mt-4">{title}</span>
          <span className="text-[14.5px] text-ink-mid leading-[1.6] mt-3">{d}</span>
          <span className="mt-auto pt-6 text-[14px] font-semibold text-peri-deep">Explore →</span>
        </Link>)}
      </div>
    </Section>

    <section className="bg-ground-cool"><div className={`${wrap} py-24 max-[800px]:py-16`}>
      <Eyebrow>Built in the open</Eyebrow>
      <H2 soft="Yours by design.">Live on Robinhood Chain.</H2>
      <GradientPanel tone="lavender" className="p-6 max-[800px]:p-4 mt-12">
        <div className="grid md:grid-cols-3 gap-4">
          {MILESTONES.map(([when, what]) => <div key={what} className="glass-card p-7"><div className="live-chip"><span className="dot" />{when}</div><p className="font-atx-display font-medium text-[1.35rem] tracking-[-0.02em] leading-[1.25] mt-5">{what}</p></div>)}
        </div>
      </GradientPanel>
      <P>Non-custodial from the first line of code — your share is yours, and no one can hold it hostage. Every contract open, every transaction on-chain. <Link href="/proof" className="text-peri-deep font-semibold no-underline hover:underline">See it on-chain →</Link></P>
    </div></section>

    <CTA title="Liquidity should be" soft="a public good.">
      <Link href="/v1" className="glass-pill-primary">Open the app</Link>
      <Link href="/issuers#talk" className="glass-pill">Talk to us</Link>
    </CTA>
    <p className={`${wrap} pb-10 text-[11.5px] text-ink-soft`}>Market data: rwa.xyz, Token Terminal, Robinhood (Oct 2026).</p>
  </main>
}

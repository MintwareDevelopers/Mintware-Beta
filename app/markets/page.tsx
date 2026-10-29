import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { DiscoverMarkets } from '@/components/marketing/DiscoverMarkets'
import { PositionCard } from '@/components/marketing/PositionCard'
import { Section, Eyebrow, H1, H2, P, Kicker, Steps, Rows, wrap, body } from '@/components/marketing/Story'

export const metadata = { title: 'Markets — Mintware', description: 'Earn what market makers earn — on the tokenized stocks, RWAs and stablecoins you believe in.' }

export default function MarketsPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="markets" />

    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-24 max-[800px]:py-16 grid lg:grid-cols-[1.25fr_1fr] gap-12 items-center`}>
        <div>
          <Eyebrow>Markets</Eyebrow>
          <H1>Earn what market makers earn.</H1>
          <p className={`${body} mt-6`}>Every trade in a tokenized stock, a real-world asset or a stablecoin pays the people who make its market. Now that can be you — with a single asset, no lockups, and full control the entire time.</p>
          <div className="flex flex-wrap gap-3 mt-8"><Link href="/v1" className="glass-pill-primary">Open the app</Link><a href="#live" className="glass-pill">See live markets</a></div>
        </div>
        <PositionCard />
      </div>
    </section>

    <Section>
      <Eyebrow>What you get</Eyebrow>
      <H2>Your money, finally on the right side of the trade.</H2>
      <Rows items={[
        ['Income from every trade.', 'Markets for tokenized assets never close. Every swap, at any hour, pays a fee — and a share of it is yours.'],
        ['Earning even when it’s quiet.', 'When trading slows, your capital doesn’t sit still. It keeps earning in yield until the market needs it again.'],
        ['A stake in what you believe in.', 'Back the markets for the stocks, real-world assets and dollars you care about — and grow with them.'],
        ['Free to leave, always.', 'No lockups, no queues, no notice periods. Take your share out whenever you want, in the actual assets.'],
        ['Nothing to manage.', 'No ranges to pick, no rebalancing, no second asset to buy. You add one asset; the rest is handled.'],
      ]} />
      <Kicker>The returns of a market maker, the freedom of cash, and none of the work.</Kicker>
    </Section>

    <Section id="live" tint>
      <Eyebrow>Live markets</Eyebrow>
      <H2>The markets worth backing, ranked in real time.</H2>
      <P>Discover watches every market on Robinhood Chain — depth, volume, price behaviour, age — and surfaces the ones worth your capital.</P>
      <div className="mt-8"><DiscoverMarkets mode="list" /></div>
    </Section>

    <Section>
      <Eyebrow>How it works</Eyebrow>
      <H2>Three steps. One of them is yours.</H2>
      <Steps items={[
        ['You add one asset', 'A stablecoin or the market’s own token. You get one share — your slice of the whole position.'],
        ['Mintware keeps it working', 'In the market when trading is busy, in yield when it’s quiet, always following the price.'],
        ['You leave when you like', 'Your share of both assets, out in a single step.'],
      ]} />
    </Section>

    <Section tint>
      <Eyebrow>Peace of mind</Eyebrow>
      <H2>Only markets worth your money.</H2>
      <Rows items={[
        ['Curated before they open.', 'Every market is reviewed — the assets, their issuers, depth and price behaviour — before it can take a dollar.'],
        ['Each market stands alone.', 'Every market runs its own engine, so what happens in one never touches another.'],
        ['Yours, start to finish.', 'Your share sits in your wallet. No custodian, no account, no permission needed to leave.'],
      ]} />
      <div className="flex flex-wrap gap-3 mt-10"><Link href="/v1" className="glass-pill-primary">Start earning from markets</Link><Link href="/earn" className="glass-pill">Just want to earn on dollars?</Link></div>
    </Section>
  </main>
}

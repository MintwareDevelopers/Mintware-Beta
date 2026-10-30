import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { DiscoverMarkets } from '@/components/marketing/DiscoverMarkets'
import { PositionCard } from '@/components/marketing/PositionCard'
import { Page, Section, Eyebrow, H2, P, Hero, Rows, Kicker, CTA } from '@/components/marketing/Story'
import { IconTrade, IconHours, IconGrow, IconExit, IconCurated, IconIsolated, IconOwned } from '@/components/ui2/MineralIcons'

export const metadata = { title: 'Markets — Mintware', description: 'Earn what market makers earn — on the tokenized stocks, RWAs and stablecoins you believe in.' }

export default function MarketsPage() {
  return <Page>
    <V2Nav active="markets" />

    <Hero
      eyebrow="Markets"
      title="Earn what"
      soft="market makers earn."
      lede="Every trade in a tokenized stock, a real-world asset or a stablecoin pays the people who make its market. Now that can be you — with a single asset, no lockups, and full control the entire time."
      actions={<><Link href="/v1" className="mw-btn mw-btn-lg">Open the app</Link><a href="#live" className="mw-btn-quiet mw-btn-lg">See live markets</a></>}
      aside={<PositionCard />}
    />

    <Section tint>
      <Eyebrow>What you get</Eyebrow>
      <H2 soft="on the right side of the trade.">Your money, finally</H2>
      <Rows items={[
        ['Income from every trade.', 'Markets for tokenized assets never close. Every swap, at any hour, pays a fee — and a share of it is yours.', <IconTrade key="t" />],
        ['Earning even when it’s quiet.', 'When trading slows, your capital doesn’t sit still. It keeps earning in yield until the market needs it again.', <IconHours key="h" />],
        ['A stake in what you believe in.', 'Back the markets for the stocks, real-world assets and dollars you care about — and grow with them.', <IconGrow key="g" />],
        ['Free to leave, always.', 'No lockups, no queues, no notice periods. Take your share out whenever you want, in the actual assets.', <IconExit key="e" />],
      ]} />
      <Kicker>The returns of a market maker, the freedom of cash — and none of the work.</Kicker>
    </Section>

    <Section id="live">
      <Eyebrow>Live markets</Eyebrow>
      <H2 soft="ranked in real time.">The markets worth backing,</H2>
      <P>Discover watches every market on Robinhood Chain — depth, volume, price behaviour, age — and surfaces the ones worth your capital.</P>
      <div className="mt-10"><DiscoverMarkets mode="list" /></div>
    </Section>

    <Section tint>
      <Eyebrow>How it works</Eyebrow>
      <H2 soft="It works on its own.">Add once.</H2>
      <GradientPanel tone="lavender" className="p-[clamp(16px,3vw,36px)] mt-12">
        <FlowDiagram steps={[
          { label: 'You add one asset', sub: 'A stablecoin or the market’s own token' },
          { label: 'You get one share', sub: 'Your slice of the whole position' },
          { label: 'Busy market → in the pool', sub: 'Earning on every trade' },
          { label: 'Quiet market → in yield', sub: 'Still earning' },
          { label: 'You leave anytime', sub: 'Your share of both assets' },
        ]} />
      </GradientPanel>
    </Section>

    <Section>
      <Eyebrow>Peace of mind</Eyebrow>
      <H2 soft="worth your money.">Only markets</H2>
      <Rows items={[
        ['Curated before they open.', 'Every market is reviewed — the assets, their issuers, depth and price behaviour — before it can take a dollar.', <IconCurated key="c" />],
        ['Each market stands alone.', 'Every market runs its own engine, so what happens in one never touches another.', <IconIsolated key="i" />],
        ['Yours, start to finish.', 'Your share sits in your wallet. No custodian, no account, no permission needed to leave.', <IconOwned key="o" />],
      ]} />
    </Section>

    <CTA title="Put your capital" soft="behind the markets that matter.">
      <Link href="/v1" className="mw-btn mw-btn-lg">Open the app</Link>
      <Link href="/cards" className="mw-btn-quiet mw-btn-lg">Spend with the card</Link>
    </CTA>
  </Page>
}

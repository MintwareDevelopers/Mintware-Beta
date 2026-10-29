import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { Section, Eyebrow, H2, P, Hero, Rows, Kicker, CTA } from '@/components/marketing/Story'

export const metadata = { title: 'Real-world assets — Mintware', description: 'Land, water, stocks and treasuries — the world’s real assets, finally liquid.' }

const ASSETS: [string, string][] = [
  ['Stocks', 'Equities, trading around the clock'],
  ['Land', 'Farmland and property, in shares'],
  ['Water', 'Rights to the scarcest resource'],
  ['Treasuries', 'The world’s benchmark yield'],
]

function AssetTiles() {
  return <div className="grid grid-cols-2 gap-3 w-full max-w-[440px]">
    {ASSETS.map(([t, d], i) => <div key={t} className={`glass-card p-6 !rounded-[22px] ${i % 2 ? 'translate-y-6' : ''}`}>
      <div className="font-atx-display font-medium text-[1.6rem] tracking-[-0.025em]">{t}</div>
      <div className="text-[13px] text-ink-mid leading-[1.45] mt-2">{d}</div>
    </div>)}
  </div>
}

export default function RwasPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="rwas" />

    <Hero
      eyebrow="Real-world assets"
      title="The world’s real assets,"
      soft="finally liquid."
      lede="Land, water, stocks, treasuries — the most valuable assets on earth have always been the hardest to buy, sell and borrow against. Tokenization makes them programmable. Mintware makes them liquid."
      actions={<><Link href="/markets" className="glass-pill-primary">Explore markets</Link><Link href="/issuers#talk" className="glass-pill">Bring an asset to market</Link></>}
      tone="coral"
      aside={<AssetTiles />}
    />

    <Section tint>
      <Eyebrow>What’s coming on-chain</Eyebrow>
      <H2 soft="is being tokenized.">Everything of value</H2>
      <Rows items={[
        ['Stocks.', 'Tesla, Nvidia, Apple and thousands more already trade as tokens on Robinhood Chain — around the clock, settled in seconds.'],
        ['Land.', 'Farmland, ranches and property, split into shares anyone can own. With a real market, anyone can also sell.'],
        ['Water.', 'Water rights — among the scarcest assets on earth — priced in the open and owned by the people who believe in them.'],
        ['Treasuries and credit.', 'The world’s benchmark yields, programmable and usable everywhere on-chain.'],
      ]} />
    </Section>

    <Section>
      <Eyebrow>The problem</Eyebrow>
      <H2 soft="is a trap.">Ownership without liquidity</H2>
      <P>A tokenized acre of farmland or acre-foot of water is only as useful as the market behind it. Without depth, owners can’t sell at a fair price, buyers can’t get in, and the asset never earns the valuation it deserves. Tokenization solved who owns it. Nobody solved how to trade it.</P>
      <Kicker tone="coral">Mintware gives every real asset a market that’s deep, fair and always open.</Kicker>
    </Section>

    <Section tint>
      <Eyebrow>What changes</Eyebrow>
      <H2 soft="and for the people who issue them.">For the people who hold real assets,</H2>
      <Rows items={[
        ['Own a piece of what’s real.', 'Land, water and equities, in amounts anyone can afford — held in your own wallet.'],
        ['Sell when you want.', 'A deep market means a fair price, at any hour, without waiting for a buyer to appear.'],
        ['Earn while you hold.', 'Back the market for an asset you believe in and earn from every trade in it.'],
        ['Real price discovery.', 'Issuers and investors finally see what an asset is worth, every minute, in public.'],
        ['Liquidity from the community.', 'Depth comes from holders, not from a market maker who leaves when the contract ends.'],
        ['Compliance that travels with the token.', 'Identity and transfer rules stay with the asset, so only verified holders take part.'],
      ]} />
    </Section>

    <Section>
      <Eyebrow>How it works</Eyebrow>
      <H2 soft="to a market.">From a real asset</H2>
      <GradientPanel tone="periwinkle" className="p-8 max-[800px]:p-4 mt-12">
        <FlowDiagram steps={[
          { label: 'A real asset', sub: 'Land, water, stocks, credit' },
          { label: 'Tokenized by its issuer', sub: 'Compliant, verified holders' },
          { label: 'Curated on Mintware', sub: 'Reviewed and opened' },
          { label: 'Holders bring depth', sub: 'Backing it with one asset' },
          { label: 'Traded at fair prices', sub: 'Around the clock' },
        ]} />
      </GradientPanel>
    </Section>

    <Section tint>
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
        <div>
          <Eyebrow>See it working</Eyebrow>
          <H2 soft="with a market of its own.">A tokenized property,</H2>
          <P>Our RWA demo runs a market for a tokenized property that only verified holders can trade, priced against an independent appraisal.</P>
          <Link href="/v1/rwas" className="inline-block mt-7 glass-pill-primary">Open the RWA demo</Link>
        </div>
        <GradientPanel tone="lavender" className="p-8 max-[800px]:p-4">
          <div className="glass-card p-7">
            <div className="flex items-center justify-between"><span className="text-[13px] font-semibold">Tokenized property · Unit 4B</span><span className="live-chip"><span className="dot" />Demo</span></div>
            <div className="grid grid-cols-2 gap-3 mt-5 text-[13px]">
              <div className="rounded-2xl bg-white/70 p-4"><div className="text-ink-mid">Appraisal</div><div className="font-atx-display font-medium text-[20px] mt-1">$412,000</div></div>
              <div className="rounded-2xl bg-white/70 p-4"><div className="text-ink-mid">Market price</div><div className="font-atx-display font-medium text-[20px] mt-1">$409,850</div></div>
              <div className="rounded-2xl bg-white/70 p-4"><div className="text-ink-mid">Holders</div><div className="font-atx-display font-medium text-[20px] mt-1">Verified only</div></div>
              <div className="rounded-2xl bg-white/70 p-4"><div className="text-ink-mid">Trading</div><div className="font-atx-display font-medium text-[20px] mt-1">24 / 7</div></div>
            </div>
          </div>
        </GradientPanel>
      </div>
    </Section>

    <CTA title="Bring a real asset" soft="to market." tone="coral">
      <Link href="/issuers#talk" className="glass-pill-primary">Talk to us</Link>
      <Link href="/markets" className="glass-pill">Explore markets</Link>
    </CTA>
  </main>
}

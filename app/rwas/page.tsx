import Link from 'next/link'
import type { ReactNode } from 'react'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { Page, Section, Eyebrow, H2, P, Hero, Rows, Kicker, CTA } from '@/components/marketing/Story'
import { IconStocks, IconLand, IconWater, IconTreasury, IconOwned, IconExit, IconGrow, IconPrice, IconHolders, IconRules } from '@/components/ui2/MineralIcons'

export const metadata = { title: 'Real-world assets — Mintware', description: 'Land, water, stocks and treasuries — the world’s real assets, finally liquid.' }

const ASSETS: [string, string, ReactNode, string][] = [
  ['Stocks', 'Equities, trading around the clock', <IconStocks key="s" size={22} />, 'linear-gradient(160deg,#E4E4FE,#A9A7FA)'],
  ['Land', 'Farmland and property, in shares', <IconLand key="l" size={22} />, 'linear-gradient(160deg,#EAF4E4,#B9D9A6)'],
  ['Water', 'Rights to the scarcest resource', <IconWater key="w" size={22} />, 'linear-gradient(160deg,#E2F0FB,#A9CDEE)'],
  ['Treasuries', 'The world’s benchmark yield', <IconTreasury key="t" size={22} />, 'linear-gradient(160deg,#FDEBDD,#F2C3A4)'],
]

// The hero object: four raised asset tiles, staggered like stones, each with its own tinted disc icon.
function AssetTiles() {
  return <div className="relative w-full max-w-[460px]">
    <div aria-hidden="true" className="absolute inset-[12%_-6%_-4%_6%] rounded-[40px] opacity-35 blur-[48px]" style={{ background: 'var(--mw-sheen)' }} />
    <div className="relative grid grid-cols-2 gap-4">
      {ASSETS.map(([t, d, icon, tint], i) => <div key={t} className={`mw-raise-lg rounded-[24px] p-6 ${i % 2 ? 'translate-y-7' : ''}`}>
        <span className="w-11 h-11 rounded-[13px] grid place-items-center" style={{ background: tint, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8)', color: '#15151D' }}>{icon}</span>
        <div className="font-semibold text-[22px] tracking-[-0.03em] mt-5">{t}</div>
        <div className="text-[13px] text-ink-mid leading-[1.45] mt-1.5">{d}</div>
      </div>)}
    </div>
  </div>
}

export default function RwasPage() {
  return <Page>
    <V2Nav active="rwas" />

    <Hero
      eyebrow="Real-world assets"
      title="The world’s real assets,"
      soft="finally liquid."
      lede="Land, water, stocks, treasuries — the most valuable assets on earth have always been the hardest to buy, sell and borrow against. Tokenization makes them programmable. Mintware makes them liquid."
      actions={<><Link href="/markets" className="mw-btn mw-btn-lg">Explore markets</Link><Link href="/issuers#talk" className="mw-btn-quiet mw-btn-lg">Bring an asset to market</Link></>}
      tone="coral"
      aside={<AssetTiles />}
    />

    <Section tint>
      <Eyebrow>What’s coming on-chain</Eyebrow>
      <H2 soft="is being tokenized.">Everything of value</H2>
      <Rows items={[
        ['Stocks.', 'Tesla, Nvidia, Apple and thousands more already trade as tokens on Robinhood Chain — around the clock, settled in seconds.', <IconStocks key="s" />],
        ['Land.', 'Farmland, ranches and property, split into shares anyone can own. With a real market, anyone can also sell.', <IconLand key="l" />],
        ['Water.', 'Water rights — among the scarcest assets on earth — priced in the open and owned by the people who believe in them.', <IconWater key="w" />],
        ['Treasuries and credit.', 'The world’s benchmark yields, programmable and usable everywhere on-chain.', <IconTreasury key="t" />],
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
        ['Own a piece of what’s real.', 'Land, water and equities, in amounts anyone can afford — held in your own wallet.', <IconOwned key="o" />],
        ['Sell when you want.', 'A deep market means a fair price, at any hour, without waiting for a buyer to appear.', <IconExit key="e" />],
        ['Earn while you hold.', 'Back the market for an asset you believe in and earn from every trade in it.', <IconGrow key="g" />],
        ['Real price discovery.', 'Issuers and investors finally see what an asset is worth, every minute, in public.', <IconPrice key="p" />],
        ['Liquidity from the community.', 'Depth comes from holders, not from a market maker who leaves when the contract ends.', <IconHolders key="h" />],
        ['Compliance that travels with the token.', 'Identity and transfer rules stay with the asset, so only verified holders take part.', <IconRules key="r" />],
      ]} />
    </Section>

    <Section>
      <Eyebrow>How it works</Eyebrow>
      <H2 soft="to a market.">From a real asset</H2>
      <GradientPanel tone="periwinkle" className="p-[clamp(16px,3vw,36px)] mt-12">
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
          <Link href="/v1/rwas" className="mw-btn mw-btn-lg mt-8">Open the RWA demo</Link>
        </div>
        <GradientPanel tone="lavender" className="p-[clamp(16px,3vw,32px)]">
          <div className="mw-raise-lg rounded-[24px] p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-[12px] grid place-items-center" style={{ background: 'linear-gradient(160deg,#EAF4E4,#B9D9A6)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8)' }}><IconLand size={20} /></span>
                <span className="text-[14px] font-semibold">Tokenized property · Unit 4B</span>
              </span>
              <span className="live-chip"><span className="dot" />Demo</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5 text-[13px]">
              {[['Appraisal', '$412,000'], ['Market price', '$409,850'], ['Holders', 'Verified only'], ['Trading', '24 / 7']].map(([k, v]) => (
                <div key={k} className="rounded-[16px] p-4" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}><div className="text-ink-soft">{k}</div><div className="font-semibold text-[19px] tracking-[-0.02em] mt-1">{v}</div></div>
              ))}
            </div>
          </div>
        </GradientPanel>
      </div>
    </Section>

    <CTA title="Bring a real asset" soft="to market." tone="coral">
      <Link href="/issuers#talk" className="mw-btn mw-btn-lg">Talk to us</Link>
      <Link href="/markets" className="mw-btn-quiet mw-btn-lg">Explore markets</Link>
    </CTA>
  </Page>
}

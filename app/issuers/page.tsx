import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Page, Section, Eyebrow, H2, P, Hero, GlassList, Rows, Kicker, CTA, IconTile } from '@/components/marketing/Story'
import { IconSpread, IconDepth, IconHolders, IconPrice, IconRules, IconStocks } from '@/components/ui2/MineralIcons'

export const metadata = { title: 'Issuers — Mintware', description: 'Your token. Real liquidity. Deep, fair markets for tokenized stocks, RWAs and stablecoins from day one.' }

// Two order books side by side: a thin one (inset, hollow) against a deep one (raised, full). Illustrative.
const THIN = [26, 16, 10, 6, 4]
const DEEP = [92, 80, 70, 62, 54]
function Book({ rows, deep }: { rows: number[]; deep?: boolean }) {
  return <div className="flex flex-col gap-1.5">
    {rows.map((w, i) => <div key={i} className="h-3 rounded-full" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
      <div className={`h-full rounded-full ${deep ? '' : 'mw-tex-hatch'}`} style={{ width: `${w}%`, backgroundColor: deep ? '#7C7AF0' : '#D9D9E2' }} />
    </div>)}
  </div>
}
function DepthCompare() {
  return <div role="img" aria-label="Illustration: a thin market with little depth beside a deep market with depth on every level" className="grid grid-cols-2 gap-4">
    <div className="mw-inset rounded-[22px] p-5">
      <div className="text-[13px] font-semibold text-ink-mid">Thin market</div>
      <div className="text-[13px] text-ink-soft mt-1">Wide spread, little depth</div>
      <div className="mt-5"><Book rows={THIN} /></div>
    </div>
    <div className="mw-raise-lg rounded-[22px] p-5" style={{ outline: '2px solid rgba(91,91,230,.28)', outlineOffset: -2 }}>
      <div className="text-[13px] font-semibold">With Mintware</div>
      <div className="text-[13px] mt-1" style={{ color: 'var(--mw-gain)' }}>Tight spread, depth on every level</div>
      <div className="mt-5"><Book rows={DEEP} deep /></div>
    </div>
  </div>
}

export default function IssuersPage() {
  return <Page>
    <V2Nav active="issuers" />

    <Hero
      eyebrow="For issuers of tokenized stocks, RWAs and stablecoins"
      title="Your token."
      soft="Real liquidity."
      lede="You did the hard part: a real asset, tokenized and compliant. Mintware makes sure it trades like one — deep, fair markets from the first day, funded by your own holders instead of a rented market maker."
      actions={<><a href="#talk" className="mw-btn mw-btn-lg">Bring your asset to market</a><Link href="/markets" className="mw-btn-quiet mw-btn-lg">See live markets</Link></>}
      tone="lavender"
      aside={<GlassList title="What your market gets" items={['Depth from day one', 'Tighter spreads and fairer prices', 'Liquidity that doesn’t leave', 'Holders who earn from your success', 'Every position visible on-chain']} />}
    />

    <Section tint>
      <Eyebrow>The launch problem</Eyebrow>
      <H2 soft="looks like a bad asset.">A great asset in a thin market</H2>
      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-10 items-center">
        <P>Wide spreads scare off buyers. A single sale moves the price. Holders who can’t get out at a fair price stop trusting the token — and the asset underneath never gets the valuation it deserves. Most issuers paper over it by renting a market maker, who leaves the day the contract ends.</P>
        <DepthCompare />
      </div>
    </Section>

    <Section>
      <Eyebrow>What you get</Eyebrow>
      <H2 soft="from day one.">A market your holders trust,</H2>
      <Rows items={[
        ['Tighter spreads, fairer prices.', 'Real depth means buyers pay what the asset is worth and sellers get out at a fair price — the foundation of trust in any token.', <IconSpread key="s" />],
        ['Liquidity that stays.', 'Your holders provide it, and they keep it there because their capital earns and is never locked. No contract to renew.', <IconDepth key="d" />],
        ['Holders who become your market.', 'The people who believe in your asset earn from its trading. Alignment you can’t buy from a market maker.', <IconHolders key="h" />],
        ['Real price discovery, in public.', 'A deep market tells everyone what the asset is truly worth — with liquidity, volume and every position on-chain.', <IconPrice key="p" />],
      ]} />
      <Kicker tone="coral">Depth you don’t have to rent.</Kicker>
    </Section>

    <Section tint>
      <Eyebrow>How it works</Eyebrow>
      <H2 soft="to traded.">From tokenized</H2>
      <GradientPanel tone="coral" className="p-[clamp(16px,3vw,36px)] mt-12">
        <FlowDiagram steps={[
          { label: 'Your asset, tokenized', sub: 'Stocks, land, water, credit' },
          { label: 'Curated by Mintware', sub: 'Reviewed and opened' },
          { label: 'Holders bring depth', sub: 'Backing it with one asset' },
          { label: 'A market that trades', sub: 'Fair prices, around the clock' },
        ]} />
      </GradientPanel>
    </Section>

    <Section>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="mw-raise rounded-[26px] p-[clamp(24px,3.4vw,40px)]">
          <IconTile><IconRules /></IconTile>
          <div className="mt-6"><Eyebrow>Built for regulated assets</Eyebrow></div>
          <h3 className="font-semibold text-[clamp(24px,2.6vw,32px)] tracking-[-0.03em] leading-[1.12] mt-3 mb-0">Your rules travel with your token.</h3>
          <p className="text-[15px] text-ink-mid leading-[1.65] mt-4">Identity and transfer rules stay with the token, so only verified holders take part. See it working with a tokenized property in our RWA demo.</p>
          <Link href="/v1/rwas" className="mw-btn-quiet mt-6">View the RWA demo →</Link>
        </div>
        <div className="mw-raise rounded-[26px] p-[clamp(24px,3.4vw,40px)]">
          <IconTile><IconStocks /></IconTile>
          <div className="mt-6"><Eyebrow>Where the market is going</Eyebrow></div>
          <h3 className="font-semibold text-[clamp(24px,2.6vw,32px)] tracking-[-0.03em] leading-[1.12] mt-3 mb-0">Robinhood Chain is where tokenized equities live.</h3>
          <p className="text-[15px] text-ink-mid leading-[1.65] mt-4">Around 2,000 stock tokens issued, the largest issuers listing with on-chain pools, and three in four dollars on the chain in tokenized equities. Mintware is built there, for exactly this market.</p>
        </div>
      </div>
    </Section>

    <section id="talk" className="scroll-mt-20">
      <CTA title="Launch" soft="with depth." tone="lavender">
        <div className="w-full max-w-[520px] mx-auto text-left">
          <p className="text-[15px] text-ink-mid text-center mb-5">We work closely with a small number of issuers at a time. Tell us about your asset.</p>
          <WaitlistForm source="issuer" button="Bring your asset to market" />
        </div>
      </CTA>
    </section>
  </Page>
}

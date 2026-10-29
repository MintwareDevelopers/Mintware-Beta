import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Section, Eyebrow, H2, P, Hero, GlassList, Rows, Steps, Kicker, CTA } from '@/components/marketing/Story'

export const metadata = { title: 'Issuers — Mintware', description: 'Your token. Our liquidity. Deep, fair markets for tokenized stocks, RWAs and stablecoins from day one.' }

export default function IssuersPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="issuers" />

    <Hero
      eyebrow="For issuers of tokenized stocks, RWAs and stablecoins"
      title="Your token."
      soft="Our liquidity."
      lede="You did the hard part: a real asset, tokenized and compliant. Mintware makes sure it trades like one — deep, fair markets from the first day, funded by your own holders instead of a rented market maker."
      actions={<><a href="#talk" className="glass-pill-primary">Bring your asset to market</a><Link href="/markets" className="glass-pill">See live markets</Link></>}
      tone="lavender"
      aside={<GlassList title="What your market gets" items={['Depth from day one', 'Tighter spreads and fairer prices', 'Liquidity that doesn’t leave', 'Holders who earn from your success', 'Every position visible on-chain']} />}
    />

    <Section tint>
      <Eyebrow>The launch problem</Eyebrow>
      <H2 soft="looks like a bad asset.">A great asset in a thin market</H2>
      <P>Wide spreads scare off buyers. A single sale moves the price. Holders who can’t get out at a fair price stop trusting the token — and the asset underneath never gets the valuation it deserves. Most issuers paper over it by renting a market maker, who leaves the day the contract ends.</P>
    </Section>

    <Section>
      <Eyebrow>What you get</Eyebrow>
      <H2 soft="from day one.">A market your holders trust,</H2>
      <Rows items={[
        ['Tighter spreads, fairer prices.', 'Real depth means buyers pay what the asset is worth and sellers get out at a fair price — the foundation of trust in any token.'],
        ['Liquidity that stays.', 'Your holders provide it, and they keep it there because their capital earns and is never locked. No contract to renew.'],
        ['Holders who become your market.', 'The people who believe in your asset earn from its trading. Alignment you can’t buy from a market maker.'],
        ['Real price discovery, in public.', 'A deep market tells everyone what the asset is truly worth — with liquidity, volume and every position on-chain.'],
      ]} />
      <Kicker tone="coral">Depth you don’t have to rent.</Kicker>
    </Section>

    <Section tint>
      <Eyebrow>How it works</Eyebrow>
      <H2 soft="to traded.">From tokenized</H2>
      <GradientPanel tone="coral" className="p-8 max-[800px]:p-4 mt-12">
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
        <div className="soft-card p-10">
          <Eyebrow>Built for regulated assets</Eyebrow>
          <h3 className="font-atx-display font-medium text-[clamp(1.6rem,3vw,2.2rem)] tracking-[-0.03em] leading-[1.1] mt-4">Your rules travel with your token.</h3>
          <p className="text-[15px] text-ink-mid leading-[1.65] mt-4">Identity and transfer rules stay with the token, so only verified holders take part. See it working with a tokenized property in our RWA demo.</p>
          <Link href="/app/rwa" className="inline-block mt-6 text-[14px] font-semibold text-peri-deep no-underline hover:underline">View the RWA demo →</Link>
        </div>
        <div className="soft-card p-10">
          <Eyebrow>Where the market is going</Eyebrow>
          <h3 className="font-atx-display font-medium text-[clamp(1.6rem,3vw,2.2rem)] tracking-[-0.03em] leading-[1.1] mt-4">Robinhood Chain is where tokenized equities live.</h3>
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
  </main>
}

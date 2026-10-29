import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Section, Eyebrow, H1, H2, P, Kicker, Steps, Rows, wrap, body } from '@/components/marketing/Story'

export const metadata = { title: 'Issuers — Mintware', description: 'Your token. Our liquidity. Deep, fair markets for tokenized stocks, RWAs and stablecoins from day one.' }

export default function IssuersPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="issuers" />

    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <Eyebrow>For issuers of tokenized stocks, RWAs and stablecoins</Eyebrow>
        <H1>Your token. Our liquidity.</H1>
        <p className={`${body} mt-6`}>You did the hard part: a real asset, tokenized and compliant. Mintware makes sure it trades like one — deep, fair markets from the first day, funded by your own holders instead of a rented market maker.</p>
        <div className="flex flex-wrap gap-3 mt-8"><a href="#talk" className="glass-pill-primary">Bring your asset to market</a><Link href="/markets" className="glass-pill">See live markets</Link></div>
      </div>
    </section>

    <Section>
      <Eyebrow>The launch problem</Eyebrow>
      <H2>A great asset in a thin market looks like a bad asset.</H2>
      <P>Wide spreads scare off buyers. A single sale moves the price. Holders who can’t get out at a fair price stop trusting the token — and the asset underneath never gets the valuation it deserves. Most issuers paper over it by renting a market maker, who leaves the day the contract ends.</P>
    </Section>

    <Section tint>
      <Eyebrow>What you get</Eyebrow>
      <H2>A market your holders trust, from day one.</H2>
      <Rows items={[
        ['Tighter spreads, fairer prices.', 'Real depth means buyers pay what the asset is worth and sellers get out at a fair price — the foundation of trust in any token.'],
        ['Liquidity that stays.', 'Your holders provide it, and they keep it there because their capital earns and is never locked. No contract to renew.'],
        ['Holders who become your market.', 'The people who believe in your asset earn from its trading. Alignment you can’t buy from a market maker.'],
        ['Real price discovery.', 'A deep market tells you, your holders and your investors what the asset is truly worth, every minute.'],
        ['Proof, in public.', 'Liquidity, volume and every position, visible on-chain to you, your holders and your regulators.'],
      ]} />
      <Kicker>Depth you don’t have to rent.</Kicker>
    </Section>

    <Section>
      <Eyebrow>How it works</Eyebrow>
      <H2>From tokenized to traded.</H2>
      <Steps items={[
        ['We curate your market', 'We review your token, structure and pool, and open it on Mintware.'],
        ['Your holders bring the depth', 'Anyone can back your market with a single asset — and earn from it.'],
        ['Your market runs itself', 'Liquidity stays in play around the clock, on its own engine on Uniswap v4.'],
      ]} />
    </Section>

    <Section tint>
      <Eyebrow>Built for regulated assets</Eyebrow>
      <H2>Your rules travel with your token.</H2>
      <P>Identity and transfer rules stay with the token, so only verified holders take part. See it working with a tokenized property in our RWA demo.</P>
      <Link href="/app/rwa" className="inline-block mt-6 text-[14px] font-semibold text-peri-deep no-underline hover:underline">View the RWA demo →</Link>
    </Section>

    <Section>
      <Eyebrow>Where the market is going</Eyebrow>
      <H2>Robinhood Chain is where tokenized equities live.</H2>
      <P>Around 2,000 stock tokens are already issued, the largest issuers are listing with on-chain pools, and three in four dollars on the chain are tokenized equities. Mintware is built there, for exactly this market.</P>
    </Section>

    <Section id="talk" tint>
      <Eyebrow>Talk to us</Eyebrow>
      <H2>Launch with depth.</H2>
      <P>We work closely with a small number of issuers at a time. Tell us about your asset.</P>
      <div className="mt-8 max-w-[520px]"><WaitlistForm source="issuer" button="Bring your asset to market" /></div>
    </Section>
  </main>
}

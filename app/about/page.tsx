import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { Section, Eyebrow, H2, P, Hero, GlassList, Rows, Kicker, CTA } from '@/components/marketing/Story'

export const metadata = { title: 'About — Mintware', description: 'Liquidity should be a public good. Why we’re building the liquidity layer for on-chain value.' }

export default function AboutPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="about" />

    <Hero
      eyebrow="About Mintware"
      title="Liquidity should be"
      soft="a public good."
      lede="Every asset is coming on-chain — stocks, property, treasuries, dollars. Owning them is becoming easy. Trading them fairly isn’t. We started Mintware so every asset gets a deep, fair market, built from capital that’s never idle, never locked, and always belongs to the people who provide it."
      tone="balanced"
      aside={<GlassList title="What we’re building" items={['Markets that pay the people who make them', 'Dollars that earn and spend', 'Depth for every tokenized asset', 'Money built for AI agents']} />}
    />

    <Section tint>
      <Eyebrow>Why we exist</Eyebrow>
      <H2 soft="has a missing piece.">The biggest shift in finance</H2>
      <P>Tokenization will move trillions of dollars of assets onto open networks, where they trade around the clock, settle in seconds and reach anyone with a wallet. But markets don’t make themselves. Without deep liquidity, tokenized assets trade at bad prices, holders can’t get out fairly, and the promise of open finance quietly turns into a set of thin, captured markets.</P>
      <P>Liquidity has always been provided by a few firms, for a fee, for as long as it suits them. We think the people who hold an asset should be able to make its market — and be paid for it — without ever giving up control of their money.</P>
    </Section>

    <Section>
      <Eyebrow>What we believe</Eyebrow>
      <H2 soft="we build by.">Three principles</H2>
      <Rows items={[
        ['Ownership means the right to leave.', 'If you can’t get your money out when you want it, you don’t really own it. Exits should always be open.'],
        ['Markets should belong to their people.', 'Not to a central bank, not to a rented market maker — to the holders who provide the liquidity and earn from it.'],
        ['Show the work.', 'Open contracts, on-chain records, plain language. Trust you can check beats trust you’re asked for.'],
      ]} />
      <Kicker>One idea underneath all of it: capital that is never idle, never locked, and always yours.</Kicker>
    </Section>

    <CTA title="Build the next market" soft="with us.">
      <Link href="/v1" className="glass-pill-primary">Open the app</Link>
      <Link href="/issuers#talk" className="glass-pill">Work with us</Link>
    </CTA>
    <p className="mx-auto max-w-[1160px] px-6 pb-10 text-[13px] text-ink-mid">Mintware LLC · Delaware</p>
  </main>
}

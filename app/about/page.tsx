import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { Section, Eyebrow, H1, H2, P, Kicker, Rows, wrap, body } from '@/components/marketing/Story'

export const metadata = { title: 'About — Mintware', description: 'Liquidity should be a public good. Why we’re building the liquidity layer for on-chain value.' }

export default function AboutPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="about" />

    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <Eyebrow>About Mintware</Eyebrow>
        <H1>Liquidity should be a public good.</H1>
        <p className={`${body} mt-6`}>Every asset is coming on-chain — stocks, property, treasuries, dollars. Owning them is becoming easy. Trading them fairly isn’t. We started Mintware so that every asset gets a deep, fair market, built from capital that’s never idle, never locked, and always belongs to the people who provide it.</p>
      </div>
    </section>

    <Section>
      <Eyebrow>Why we exist</Eyebrow>
      <H2>The biggest shift in finance has a missing piece.</H2>
      <P>Tokenization will move trillions of dollars of assets onto open networks, where they trade around the clock, settle in seconds and reach anyone with a wallet. But markets don’t make themselves. Without deep liquidity, tokenized assets trade at bad prices, holders can’t get out fairly, and the promise of open finance quietly turns into a set of thin, captured markets.</P>
      <P>Liquidity has always been provided by a few firms, for a fee, for as long as it suits them. We think the people who hold an asset should be able to make its market — and be paid for it — without ever giving up control of their money.</P>
    </Section>

    <Section tint>
      <Eyebrow>What we believe</Eyebrow>
      <H2>Three principles we build by.</H2>
      <Rows items={[
        ['Ownership means the right to leave.', 'If you can’t get your money out when you want it, you don’t really own it. Exits should always be open.'],
        ['Markets should belong to their people.', 'Not to a central bank, not to a rented market maker — to the holders who provide the liquidity and earn from it.'],
        ['Show the work.', 'Open contracts, on-chain records, plain language. Trust you can check beats trust you’re asked for.'],
      ]} />
    </Section>

    <Section>
      <Eyebrow>What we’re building</Eyebrow>
      <H2>The liquidity layer for on-chain value.</H2>
      <P>Markets that let anyone earn what market makers earn. Earn, for dollars that work and spend. A card that pays from a balance that never stops working. Tools for issuers who want their assets to trade like they deserve, and for the AI agents that will soon move money on their own.</P>
      <Kicker>One idea underneath all of it: capital that is never idle, never locked, and always yours.</Kicker>
      <div className="flex flex-wrap gap-3 mt-10"><Link href="/v1" className="glass-pill-primary">Open the app</Link><Link href="/issuers#talk" className="glass-pill">Work with us</Link></div>
      <p className="text-[13px] text-ink-mid mt-12">Mintware LLC · Delaware</p>
    </Section>
  </main>
}

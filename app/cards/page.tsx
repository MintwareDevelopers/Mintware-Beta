import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Section, Eyebrow, H2, Hero, GlassList, Rows, Steps, Kicker, CTA } from '@/components/marketing/Story'

export const metadata = { title: 'Card — Mintware', description: 'Spend what you’ve earned. A card whose balance never stops working.' }

export default function CardsPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="cards" />

    <Hero
      eyebrow="Card"
      title="Spend what"
      soft="you’ve earned."
      lede="Most cards spend money that’s doing nothing. Yours spends from a balance that’s earning — and refills itself as you go, so everything you don’t spend keeps working."
      actions={<div className="w-full max-w-[480px]"><WaitlistForm source="card" /></div>}
      tone="coral"
      aside={<GlassList title="Your Mintware card" items={['Spends from an earning balance', 'Refills itself as you go', 'Limits you set', 'Cut off any card instantly']} />}
    />

    <Section tint>
      <Eyebrow>What you get</Eyebrow>
      <H2 soft="until the moment you spend it.">Every dollar earning</H2>
      <Rows items={[
        ['No idle float.', 'You don’t pre-load a card and watch it sit. Your money stays in Earn, working, until a purchase needs it.'],
        ['Spend without selling.', 'Pay for coffee, flights or payroll without unwinding anything. Only what you spend leaves.'],
        ['Everywhere cards work.', 'Issued on established card rails with Bridge and Stripe, for the places you already pay.'],
      ]} />
      <Kicker>Your money earns while you live your life — not just while it sits still.</Kicker>
    </Section>

    <Section>
      <Eyebrow>How it works</Eyebrow>
      <H2 soft="You spend it.">Earn fills it.</H2>
      <Steps items={[
        ['Your balance earns in Earn', 'Stablecoins grow in a curated lending market.'],
        ['Your card refills itself', 'As you spend, Earn tops your card up — within limits you set.'],
        ['Everything else keeps working', 'Only what you need ever moves. The rest stays put, earning.'],
      ]} />
    </Section>

    <Section tint>
      <Eyebrow>Always in control</Eyebrow>
      <H2 soft="and when.">You decide what can move,</H2>
      <Rows items={[
        ['Daily limits you set.', 'Refills never exceed the limits you choose.'],
        ['Every card link is yours to approve.', 'A new card wallet goes live after 48 hours, and you can cut one off instantly.'],
        ['Non-custodial underneath.', 'Your balance sits in your wallet as Earn shares. Nobody can move it but you.'],
      ]} />
    </Section>

    <CTA title="A card for money" soft="that never sits still." tone="coral">
      <div className="w-full max-w-[480px] mx-auto"><WaitlistForm source="card" /></div>
      <div className="w-full flex justify-center mt-2"><Link href="/earn" className="glass-pill">How Earn works</Link></div>
    </CTA>
  </main>
}

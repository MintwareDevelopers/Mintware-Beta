import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Section, Eyebrow, H1, H2, Kicker, Steps, Rows, wrap, body } from '@/components/marketing/Story'

export const metadata = { title: 'Card — Mintware', description: 'Spend what you’ve earned. A card whose balance never stops working.' }

export default function CardsPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="cards" />

    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <Eyebrow>Card</Eyebrow>
        <H1>Spend what you’ve earned.</H1>
        <p className={`${body} mt-6`}>Most cards spend money that’s doing nothing. Yours spends from a balance that’s earning — and refills itself as you go, so everything you don’t spend keeps working.</p>
        <div className="mt-8 max-w-[520px]"><WaitlistForm source="card" /></div>
      </div>
    </section>

    <Section>
      <Eyebrow>What you get</Eyebrow>
      <H2>Every dollar earning until the moment you spend it.</H2>
      <Rows items={[
        ['No idle float.', 'You don’t pre-load a card and watch it sit. Your money stays in Earn, working, until a purchase needs it.'],
        ['Spend without selling.', 'Pay for coffee, flights or payroll without unwinding your position. Only what you spend leaves.'],
        ['Everywhere cards work.', 'Issued on established card rails with Bridge and Stripe, for the places you already pay.'],
      ]} />
      <Kicker>Your money earns while you live your life — not just while it sits still.</Kicker>
    </Section>

    <Section tint>
      <Eyebrow>How it works</Eyebrow>
      <H2>Earn fills it. You spend it.</H2>
      <Steps items={[
        ['Your balance earns in Earn', 'Stablecoins grow in a curated lending market.'],
        ['Your card refills itself', 'As you spend, Earn tops your card up — within limits you set.'],
        ['Everything else keeps working', 'Only what you need ever moves. The rest stays put, earning.'],
      ]} />
    </Section>

    <Section>
      <Eyebrow>Always in control</Eyebrow>
      <H2>You decide what can move, and when.</H2>
      <Rows items={[
        ['Daily limits you set.', 'Refills never exceed the limits you choose.'],
        ['Every card link is yours to approve.', 'A new card wallet goes live after 48 hours, and you can cut one off instantly.'],
        ['Non-custodial underneath.', 'Your balance sits in your wallet as Earn shares. Nobody can move it but you.'],
      ]} />
      <div className="flex flex-wrap gap-3 mt-10"><Link href="/earn" className="glass-pill">How Earn works</Link></div>
    </Section>
  </main>
}

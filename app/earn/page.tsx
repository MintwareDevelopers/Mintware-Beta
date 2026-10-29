import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Section, Eyebrow, H1, H2, P, Kicker, Steps, Rows, wrap, body } from '@/components/marketing/Story'

export const metadata = { title: 'Earn — Mintware', description: 'Your dollars, working. Your card, ready. Stablecoins that earn and spend.' }

export default function EarnPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="earn" />

    <section className="bg-ground-cool border-b border-hair-soft">
      <div className={`${wrap} py-24 max-[800px]:py-16`}>
        <Eyebrow>Earn</Eyebrow>
        <H1>Your dollars, working. Your card, ready.</H1>
        <p className={`${body} mt-6`}>Hundreds of billions of stablecoins sit still in wallets and exchanges, earning nothing. Earn puts yours to work, keeps it yours to take back at any moment, and pays for your life as you spend.</p>
        <div className="mt-8 max-w-[520px]"><WaitlistForm source="earn" /></div>
      </div>
    </section>

    <Section>
      <Eyebrow>What you get</Eyebrow>
      <H2>Money that works as hard as you do.</H2>
      <Rows items={[
        ['Your dollars earn, every second.', 'Stablecoins in Earn grow from a curated lending market — around the clock, without you lifting a finger.'],
        ['Spend without selling.', 'Pay with your card and only what you spend leaves. Everything else keeps earning.'],
        ['Take it back anytime.', 'No lockups, no notice periods. Your balance is yours to withdraw whenever you want.'],
        ['You can see where it goes.', 'One carefully chosen source, visible on-chain. No black box, no hopping between strategies.'],
      ]} />
      <Kicker>The convenience of a card, with a balance that never stops working.</Kicker>
    </Section>

    <Section tint>
      <Eyebrow>How it works</Eyebrow>
      <H2>Set it up once. Let it work.</H2>
      <Steps items={[
        ['Add stablecoins', 'Put USDC into Earn. It starts working immediately.'],
        ['Link your card', 'Your card tops itself up from Earn as you spend, within limits you set.'],
        ['Spend or withdraw', 'Use your card anywhere, or take your balance back whenever you like.'],
      ]} />
    </Section>

    <Section>
      <Eyebrow>Always in control</Eyebrow>
      <H2>Your money moves only where you say.</H2>
      <Rows items={[
        ['Daily limits you choose.', 'Your card can only refill up to the limits you set.'],
        ['New cards wait 48 hours.', 'Linking a new card wallet takes effect after a short delay — and you can cut any card off instantly.'],
        ['Non-custodial.', 'Your balance sits in your own wallet as Earn shares. Nobody can move it but you.'],
      ]} />
    </Section>

    <Section tint>
      <Eyebrow>One yield engine underneath</Eyebrow>
      <H2>Your dollars and your markets, working together.</H2>
      <P>The same curated yield engine sits under every Mintware market. Hold dollars in Earn, back the markets you believe in — either way, nothing sits idle.</P>
      <div className="flex flex-wrap gap-3 mt-9"><Link href="/markets" className="glass-pill">Explore markets</Link><Link href="/cards" className="glass-pill">See the card</Link></div>
    </Section>
  </main>
}

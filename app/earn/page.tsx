import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Section, Eyebrow, H2, P, Hero, GlassList, Rows, Steps, Kicker, CTA } from '@/components/marketing/Story'

export const metadata = { title: 'Earn — Mintware', description: 'Your dollars, working. Your card, ready. Stablecoins that earn and spend.' }

export default function EarnPage() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav active="earn" />

    <Hero
      eyebrow="Earn"
      title="Your dollars, working."
      soft="Your card, ready."
      lede="Hundreds of billions of stablecoins sit still in wallets and exchanges, earning nothing. Earn puts yours to work, keeps it yours to take back at any moment, and pays for your life as you spend."
      actions={<div className="w-full max-w-[480px]"><WaitlistForm source="earn" /></div>}
      tone="balanced"
      aside={<GlassList title="Your dollars in Earn" items={['Earning every second', 'Spendable with your card', 'Yours to withdraw anytime', 'One curated source you can see']} />}
    />

    <Section tint>
      <Eyebrow>What you get</Eyebrow>
      <H2 soft="as hard as you do.">Money that works</H2>
      <Rows items={[
        ['Your dollars earn, every second.', 'Stablecoins in Earn grow from a curated lending market — around the clock, without you lifting a finger.'],
        ['Spend without selling.', 'Pay with your card and only what you spend leaves. Everything else keeps earning.'],
        ['Take it back anytime.', 'No lockups, no notice periods. Your balance is yours to withdraw whenever you want.'],
        ['You can see where it goes.', 'One carefully chosen source, visible on-chain. No black box, no hopping between strategies.'],
      ]} />
      <Kicker tone="coral">The convenience of a card, with a balance that never stops working.</Kicker>
    </Section>

    <Section>
      <Eyebrow>How it works</Eyebrow>
      <H2 soft="Let it work.">Set it up once.</H2>
      <Steps items={[
        ['Add stablecoins', 'Put USDC into Earn. It starts working immediately.'],
        ['Link your card', 'Your card tops itself up from Earn as you spend, within limits you set.'],
        ['Spend or withdraw', 'Use your card, or take your balance back whenever you like.'],
      ]} />
    </Section>

    <Section tint>
      <Eyebrow>Always in control</Eyebrow>
      <H2 soft="only where you say.">Your money moves</H2>
      <Rows items={[
        ['Daily limits you choose.', 'Your card can only refill up to the limits you set.'],
        ['New cards wait 48 hours.', 'Linking a new card wallet takes effect after a short delay — and you can cut any card off instantly.'],
        ['Non-custodial.', 'Your balance sits in your own wallet as Earn shares. Nobody can move it but you.'],
      ]} />
    </Section>

    <Section>
      <Eyebrow>One yield engine underneath</Eyebrow>
      <H2 soft="working together.">Your dollars and your markets,</H2>
      <P>The same curated yield engine sits under every Mintware market. Hold dollars in Earn, back the markets you believe in — either way, nothing sits idle.</P>
    </Section>

    <CTA title="Put your dollars" soft="to work.">
      <div className="w-full max-w-[480px] mx-auto"><WaitlistForm source="earn" /></div>
      <div className="w-full flex flex-wrap justify-center gap-3 mt-2"><Link href="/markets" className="glass-pill">Explore markets</Link><Link href="/cards" className="glass-pill">See the card</Link></div>
    </CTA>
  </main>
}

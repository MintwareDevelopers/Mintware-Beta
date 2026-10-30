import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Page, Section, Eyebrow, H2, Hero, Rows, Kicker, CTA } from '@/components/marketing/Story'
import { IconHours, IconExit, IconCard, IconLimit, IconApprove, IconOwned } from '@/components/ui2/MineralIcons'
import { CardVisual } from '@/components/marketing/CardVisual'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'

export const metadata = { title: 'Card — Mintware', description: 'Spend what you’ve earned. A card whose balance never stops working.' }

export default function CardsPage() {
  return <Page>
    <V2Nav active="cards" />

    <Hero
      eyebrow="Card"
      title="Spend what"
      soft="you’ve earned."
      lede="Most cards spend money that’s doing nothing. Yours spends from a balance that’s earning — and refills itself as you go, so everything you don’t spend keeps working."
      actions={<div className="w-full max-w-[480px]"><WaitlistForm source="card" /></div>}
      tone="coral"
      aside={<CardVisual />}
    />

    <Section tint>
      <Eyebrow>What you get</Eyebrow>
      <H2 soft="until the moment you spend it.">Every dollar earning</H2>
      <Rows items={[
        ['No idle float.', 'You don’t pre-load a card and watch it sit. Your card balance stays working, until a purchase needs it.', <IconHours key="h" />],
        ['Spend without selling.', 'Pay for coffee, flights or payroll without unwinding anything. Only what you spend leaves.', <IconExit key="e" />],
        ['Everywhere cards work.', 'Issued on established card rails with Bridge and Stripe, for the places you already pay.', <IconCard key="c" />],
      ]} />
      <Kicker>Your money earns while you live your life — not just while it sits still.</Kicker>
    </Section>

    <Section>
      <Eyebrow>How it works</Eyebrow>
      <H2 soft="You spend it.">Your balance earns.</H2>
      <GradientPanel tone="coral" className="p-[clamp(16px,3vw,36px)] mt-12">
        <FlowDiagram steps={[
          { label: 'Your balance earns', sub: 'Stablecoins in a curated lending market' },
          { label: 'You tap to pay', sub: 'Anywhere cards are accepted' },
          { label: 'Your card refills', sub: 'Only the amount you spent, within your limits' },
          { label: 'The rest keeps working', sub: 'Nothing else moves' },
        ]} />
      </GradientPanel>
    </Section>

    <Section tint>
      <Eyebrow>Always in control</Eyebrow>
      <H2 soft="and when.">You decide what can move,</H2>
      <Rows items={[
        ['Daily limits you set.', 'Refills never exceed the limits you choose.', <IconLimit key="l" />],
        ['Every card link is yours to approve.', 'A new card wallet goes live after 48 hours, and you can cut one off instantly.', <IconApprove key="a" />],
        ['Non-custodial underneath.', 'Your balance sits in your own wallet as shares. Nobody can move it but you.', <IconOwned key="o" />],
      ]} />
    </Section>

    <CTA title="A card for money" soft="that never sits still." tone="coral">
      <div className="w-full max-w-[480px] mx-auto"><WaitlistForm source="card" /></div>
      <div className="w-full flex justify-center mt-2"><Link href="/markets" className="mw-btn-quiet">Explore markets</Link></div>
    </CTA>
  </Page>
}

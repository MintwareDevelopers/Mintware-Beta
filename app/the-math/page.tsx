import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { Section, Eyebrow, H2, P, Rows, Kicker, CTA, wrap } from '@/components/marketing/Story'
import { MathCalculator, BenchmarkTable } from '@/components/marketing/MathCalculator'

export const metadata = { title: 'The math — Mintware', description: 'How a Mintware market earns: trading fees while capital is in the pool, lending yield while it waits. Run the numbers at today’s rates.' }

export default function TheMath() {
  return <main className="min-h-screen bg-white text-ink">
    <V2Nav />

    <section className="bg-white">
      <div className={`${wrap} pt-16 pb-10 max-[800px]:pt-10`}>
        <Eyebrow>The math</Eyebrow>
        <h1 className="font-atx-display tracking-[-0.04em] leading-[1.02] font-medium text-[clamp(2.8rem,6.4vw,5.2rem)] max-w-[16ch] mt-5">
          Two sources of return. <span className="text-ink-soft">One balance.</span>
        </h1>
        <p className="text-ink-mid text-[16.5px] leading-[1.7] max-w-[62ch] mt-7">
          A Mintware market earns trading fees while your capital is in the pool, and lending yield while it waits beside it. Move the sliders to see what that blend earns at today’s rates.
        </p>
      </div>
      <div className={`${wrap} pb-24 max-[800px]:pb-16`}>
        <GradientPanel tone="lavender" className="p-8 max-[800px]:p-4">
          <MathCalculator />
        </GradientPanel>
      </div>
    </section>

    <Section tint>
      <Eyebrow>Where the return comes from</Eyebrow>
      <H2 soft="never sits still.">Every dollar has a job, and</H2>
      <Rows items={[
        ['Trading fees.', 'When the market is busy, your capital sits in the pool and earns a share of every trade — the income market makers have always kept for themselves.'],
        ['Idle yield.', 'When it isn’t needed in the pool, the same capital earns in a curated lending market instead of sitting dead.'],
      ]} />
    </Section>

    <Section>
      <Eyebrow>Why the blend wins</Eyebrow>
      <H2 soft="beats either one alone.">Fees plus yield</H2>
      <P>Lending alone is steady but modest. A pool alone earns well when it trades and nothing when it doesn’t. Blending the two means the busy hours earn fees and the quiet hours still earn yield — so the balance is working around the clock, and you can withdraw it whenever you like.</P>
      <Kicker>Market-maker income on the busy days. Lending yield on the quiet ones.</Kicker>
    </Section>

    <Section tint>
      <Eyebrow>The numbers behind it</Eyebrow>
      <H2 soft="pulled live.">Today’s rates,</H2>
      <BenchmarkTable />
    </Section>

    <CTA title="Put your balance" soft="to work.">
      <Link href="/v1" className="glass-pill-primary">Explore live markets</Link>
      <Link href="/markets" className="glass-pill">How markets work</Link>
    </CTA>
  </main>
}

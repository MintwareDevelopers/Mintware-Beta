'use client'

// The V1 face of a secondary marketing page. Two honest variants:
//  • live=true  — the page's topic IS the live product (Earn / DeFi): a concise LP-gateway pitch.
//  • live=false — the topic is pure V2 vision (Teams / YPN / Agents) with no V1 equivalent yet: a
//    "here's where we're headed; the live product today is the LP Gateway → Launch" roadmap card,
//    rather than inventing V1 product that isn't real.

import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { useLaunch } from '@/components/web2/LaunchModal'

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'

export function V1MarketingStub({ topic, headline, blurb, live }: { topic: string; headline: string; blurb: string; live: boolean }) {
  const { launch } = useLaunch()
  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen overflow-x-clip">
      <V2Nav />
      <section className="bg-ground-cool">
        <div className="mx-auto max-w-[820px] px-7 max-[640px]:px-[18px] pt-[96px] pb-[80px] max-[640px]:pt-[60px] flex flex-col items-center text-center">
          <div className={ey}>{live ? `${topic} · live` : 'On the roadmap'}</div>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.06] text-[clamp(2rem,4.4vw,3rem)] mt-3 [text-wrap:balance] max-w-[19ch]">
            {headline}
          </h1>
          <p className="text-ink-mid text-[16px] leading-[1.6] mt-5 max-w-[52ch]">{blurb}</p>

          {live ? (
            <button onClick={() => launch()} className="glass-pill-primary mt-8">Launch the app →</button>
          ) : (
            <div className="mt-8 soft-card p-[22px] max-w-[440px]">
              <div className="text-[13px] font-semibold text-ink">The live product today</div>
              <p className="text-[13.5px] text-ink-mid mt-1.5 leading-[1.55]">
                Deposit USDG into a curated Robinhood Chain pool, earn trading fees, and spend the fees —
                never your principal. That&rsquo;s live now.
              </p>
              <button onClick={() => launch()} className="glass-pill-primary mt-4">Launch the app →</button>
            </div>
          )}

          <p className="text-[12px] text-ink-soft mt-6 max-w-[62ch]">
            In testing on Robinhood Chain — testnet, not yet audited. Not a deposit or a guaranteed return;
            a liquidity position is subject to impermanent loss.{' '}
            <Link href="/legal" className="text-peri-deep font-semibold no-underline hover:underline">Legal →</Link>
          </p>
        </div>
      </section>
    </div>
  )
}

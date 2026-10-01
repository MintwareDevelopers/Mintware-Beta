'use client'

// V1 homepage — the live product front: the Robinhood Chain LP Gateway. Leads with the real thing
// (deposit USDG → briefly staged → your full deposit provides liquidity to a curated pool → fees compound
// back in), not the full V2 vision. Honest testnet framing; no par / guaranteed / deposit-savings language.
// Earn-vs-LP decision (2026-09-08): no held-back reserve, no spendable buffer — see
// docs/developers/lp-gateway-earn-vs-lp-decision.md.

import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { useLaunch } from '@/components/web2/LaunchModal'
import { ModelDiagram } from '@/components/marketing/how/ModelDiagram'
import { V1_LP } from '@/components/marketing/how/diagrams'

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'

export function HomeV1() {
  const { launch } = useLaunch()
  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen overflow-x-clip">
      <V2Nav />

      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] pt-[84px] pb-[64px] max-[640px]:pt-[56px] flex flex-col items-center text-center">
          <span className="live-chip mb-6"><span className="dot" aria-hidden />Live on Robinhood Chain · testnet</span>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.04em] leading-[1.04] text-[clamp(2.4rem,6vw,4.2rem)] [text-wrap:balance] max-w-[16ch]">
            Earn on the pools. <span className="text-gradient-accent">Never locked.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1.02rem,1.6vw,1.24rem)] leading-[1.55] mt-6 max-w-[52ch]">
            Deposit USDG. Your full deposit provides liquidity to a curated Robinhood Chain pool and earns
            trading fees, compounded back into your position. No range to pick, no rebalancing to manage.
          </p>
          <div className="mt-9 flex flex-wrap gap-3.5 items-center justify-center">
            <button onClick={() => launch()} className="glass-pill-primary">Launch app →</button>
            <Link href="/app" className="text-[14.5px] font-semibold text-ink-mid hover:text-ink no-underline inline-flex items-center min-h-[44px]">See the pools →</Link>
          </div>
        </div>
      </section>

      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] py-[64px]">
          <div className={ey}>How it works</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.1] text-[clamp(1.5rem,2.6vw,2.1rem)] mt-3 [text-wrap:balance]">
            From deposit to fees, in one picture.
          </h2>
          <p className="text-[14.5px] text-ink-mid mt-3 max-w-[62ch] leading-[1.55]">
            Your full deposit becomes liquidity in a curated Uniswap v4 pool, and trading fees compound back in.
            Withdraw anytime for both legs. 100% of any impermanent loss is yours; Mintware supplies no capital.
          </p>
          <ModelDiagram spec={V1_LP} className="mt-7" />
          <Link href="/how-it-works" className="inline-block mt-5 text-[14px] font-semibold text-peri-deep no-underline hover:underline">See the full model →</Link>
        </div>
      </section>

      <section className="bg-ground-cool">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] py-[64px]">
          <GradientPanel tone="lavender" className="p-[36px] max-[640px]:p-7 text-center flex flex-col items-center">
            <div className={ey}>Every dollar earning, always yours</div>
            <h2 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.1] text-[clamp(1.5rem,2.6vw,2.1rem)] mt-3 max-w-[22ch] [text-wrap:balance]">
              Your full deposit is deployed as liquidity, earning pool fees that compound back in.
            </h2>
            <button onClick={() => launch()} className="glass-pill-primary mt-6">Launch app →</button>
          </GradientPanel>

          <p className="text-[12px] text-ink-soft mt-6 leading-[1.55] max-w-[70ch] mx-auto text-center">
            In testing on Robinhood Chain — testnet, not yet audited. A liquidity position is not a
            deposit, a savings product, or a guaranteed or fixed return: its value moves with the pool
            price and is subject to impermanent loss. External audit gates real value.{' '}
            <Link href="/legal" className="text-peri-deep font-semibold no-underline hover:underline">Legal →</Link>
          </p>
        </div>
      </section>
    </div>
  )
}

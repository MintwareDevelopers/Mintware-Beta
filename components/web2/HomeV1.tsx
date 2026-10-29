'use client'

// Public homepage for current MarketEngine testnet development.

import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { useLaunch } from '@/components/web2/LaunchModal'

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'

const STEPS: [string, string, string][] = [
  ['01', 'Test pool', 'MarketEngine is live on Robinhood Chain testnet with a tUSDG/tPONS pool.'],
  ['02', 'Adapters hold assets', 'Testnet adapters hold test assets without earning yield; they do not support real-value activity.'],
  ['03', 'Past testnet records', 'Historical proof pages link to earlier testnet runs. These records are not current customer activity.'],
]

export function HomeV1() {
  const { launch } = useLaunch()
  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen overflow-x-clip">
      <V2Nav />

      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] pt-[84px] pb-[64px] max-[640px]:pt-[56px] flex flex-col items-center text-center">
          <span className="live-chip mb-6"><span className="dot" aria-hidden />MarketEngine · testnet · unaudited</span>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.04em] leading-[1.04] text-[clamp(2.4rem,6vw,4.2rem)] [text-wrap:balance] max-w-[16ch]">
            Earn on the pools. <span className="text-gradient-accent">Never locked.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1.02rem,1.6vw,1.24rem)] leading-[1.55] mt-6 max-w-[52ch]">
            The current test pool uses tUSDG and tPONS. Adapters hold these test assets without yield; no real-value returns are available.
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
          <div className="grid grid-cols-3 max-[720px]:grid-cols-1 gap-6 mt-5">
            {STEPS.map(([n, t, d]) => (
              <div key={n}>
                <div className="font-mono text-[13px] font-bold text-peri-deep">{n}</div>
                <h3 className="font-semibold text-[17px] mt-2 text-ink">{t}</h3>
                <p className="text-[13.5px] text-ink-mid mt-1.5 leading-[1.55]">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-ground-cool">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] py-[64px]">
          <GradientPanel tone="lavender" className="p-[36px] max-[640px]:p-7 text-center flex flex-col items-center">
            <div className={ey}>Current testnet status</div>
            <h2 className="font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.1] text-[clamp(1.5rem,2.6vw,2.1rem)] mt-3 max-w-[22ch] [text-wrap:balance]">
              MarketEngine is live on testnet; its adapters hold assets without yield.
            </h2>
            <button onClick={() => launch()} className="glass-pill-primary mt-6">Launch app →</button>
          </GradientPanel>

          <p className="text-[12px] text-ink-soft mt-6 leading-[1.55] max-w-[70ch] mx-auto text-center">
            The tUSDG/tPONS test pool is unaudited and has no real-value returns. Any future pool position could move with token prices and incur impermanent loss. External audit gates real value.{' '}
            <Link href="/legal" className="text-peri-deep font-semibold no-underline hover:underline">Legal →</Link>
          </p>
        </div>
      </section>
    </div>
  )
}

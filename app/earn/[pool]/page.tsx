'use client'

// /earn/[pool] — public pool preview (no login). The distribution landing surface a token community
// drops into Discord/X: live-ish stats + a plain-language explainer + a connect CTA, before asking
// anyone to connect a wallet. Honesty: phase-1 is testnet-first on Robinhood Chain — kept explicit
// per the repo's legal lines; the "live, no hedging" framing is for post-audit real-value, not now.
// No par / guaranteed / deposit-savings language anywhere.

import { use } from 'react'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { useLaunch } from '@/components/web2/LaunchModal'

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'

// Illustrative until the discovery indexer lands — clearly labelled, never presented as a projection.
const ILLUSTRATIVE: Record<string, { pair: string; feeTvl: string; volTvl: string; tvl: string }> = {
  'pons-usdg': { pair: 'PONS / USDG', feeTvl: '—', volTvl: '3.7×', tvl: '$8.1M' },
  'meme-usdg': { pair: 'MEME / USDG', feeTvl: '—', volTvl: '9.6×', tvl: '$1.6M' },
  'shroom-usdg': { pair: 'SHROOM / USDG', feeTvl: '—', volTvl: '9.2×', tvl: '$818K' },
}

export default function EarnPoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = use(params)
  const { launch } = useLaunch()
  const p = ILLUSTRATIVE[pool.toLowerCase()] ?? { pair: pool.toUpperCase(), feeTvl: '—', volTvl: '—', tvl: '—' }

  const stat = (k: string, v: string) => (
    <div className="soft-card p-[18px] flex-1 min-w-[130px]">
      <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-ink-soft">{k}</div>
      <div className="font-mono font-bold text-[22px] text-ink mt-1.5">{v}</div>
    </div>
  )

  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen overflow-x-clip">
      <V2Nav />
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[900px] px-7 max-[640px]:px-[18px] pt-[72px] pb-[64px] max-[640px]:pt-[48px]">
          <div className={ey}>Earn — pool preview</div>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(2rem,4.6vw,3.2rem)] mt-3 [text-wrap:balance]">
            Put USDG to work in <span className="text-gradient-accent">{p.pair}</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.5vw,1.18rem)] leading-[1.55] mt-5 max-w-[54ch]">
            Deposit USDG. It earns from the moment it lands, then provides liquidity to this pool and
            earns a share of its trading fees. You spend the <b className="text-ink">fees</b> — never your
            principal. No range to pick, no rebalancing to manage.
          </p>

          <div className="flex gap-3 mt-7 flex-wrap">
            {stat('TVL', p.tvl)}
            {stat('Volume / TVL', p.volTvl)}
            {stat('Fee / TVL (24h)', p.feeTvl)}
          </div>

          <div className="mt-8 flex flex-wrap gap-3.5 items-center">
            <button onClick={() => launch()} className="glass-pill-primary">Connect to deposit →</button>
            <Link href="/app/vaults" className="text-[14.5px] font-semibold text-ink-mid hover:text-ink no-underline inline-flex items-center min-h-[44px]">
              See all pools →
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[900px] px-7 max-[640px]:px-[18px] py-[56px]">
          <GradientPanel tone="lavender" className="p-[28px] max-[640px]:p-6">
            <div className={ey}>How it works</div>
            <div className="grid grid-cols-3 max-[720px]:grid-cols-1 gap-5 mt-4">
              <div><div className="font-mono text-[13px] font-bold text-peri-deep">01</div><h3 className="font-semibold text-[15px] mt-1.5 text-ink">Earns while it waits</h3><p className="text-[13.5px] text-ink-mid mt-1 leading-[1.5]">Idle USDG earns in a lending vault until it&rsquo;s paired into the pool.</p></div>
              <div><div className="font-mono text-[13px] font-bold text-peri-deep">02</div><h3 className="font-semibold text-[15px] mt-1.5 text-ink">Earns trading fees</h3><p className="text-[13.5px] text-ink-mid mt-1 leading-[1.5]">Your liquidity collects a share of every swap through the pool.</p></div>
              <div><div className="font-mono text-[13px] font-bold text-peri-deep">03</div><h3 className="font-semibold text-[15px] mt-1.5 text-ink">Spend the fees</h3><p className="text-[13.5px] text-ink-mid mt-1 leading-[1.5]">Harvested fees fund a spendable balance — principal keeps working.</p></div>
            </div>
          </GradientPanel>

          <p className="text-[12px] text-ink-soft mt-6 leading-[1.55] max-w-[70ch]">
            In testing on Robinhood Chain — testnet, not yet audited. This is a liquidity position, not a
            deposit, a savings product, or a guaranteed or fixed return: its value moves with the pool&rsquo;s
            price and is subject to impermanent loss, and a withdrawal returns your pro-rata share of the
            pool&rsquo;s two assets at the current price. Figures shown are illustrative, not a projection.
            External audit gates real value. <Link href="/legal" className="text-peri-deep font-semibold no-underline hover:underline">Legal →</Link>
          </p>
        </div>
      </section>
    </div>
  )
}

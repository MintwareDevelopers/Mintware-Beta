'use client'

// YieldCalculatorWidget — illustrative estimator. Pure local state (two sliders),
// no wallet/app hooks. Monthly Yield = (Balance * APY) / 12. v2 Privy-esque.

import { useState } from 'react'
import { YPN_CALCULATOR } from '@/constants/ypn-landing'
import { GradientPanel } from '@/components/ui2/GradientPanel'

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n)}`
}
function fmtUSDFull(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function YieldCalculatorWidget() {
  const { tvl, apy } = YPN_CALCULATOR
  const [tvlVal, setTvlVal] = useState<number>(tvl.default)
  const [apyVal, setApyVal] = useState<number>(apy.default)

  const annual = (tvlVal * apyVal) / 100
  const monthly = annual / 12

  return (
    <section className="bg-white border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_CALCULATOR.eyebrow}</div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,3.8vw,2.8rem)] mt-3 max-w-[20ch] [text-wrap:balance]">
          {YPN_CALCULATOR.title}
        </h2>
        <p className="text-ink-mid text-[15px] leading-[1.5] mt-4 max-w-[60ch]">{YPN_CALCULATOR.sub}</p>

        <div className="mt-9 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4 max-[860px]:grid-cols-1">
          {/* Inputs */}
          <div className="soft-card p-7 flex flex-col gap-8">
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{tvl.label}</span>
                <span className="font-atx-display text-[19px] font-medium text-peri-deep tabular-nums">{fmtUSD(tvlVal)}</span>
              </div>
              <input type="range" min={tvl.min} max={tvl.max} step={tvl.step} value={tvlVal} onChange={(e) => setTvlVal(Number(e.target.value))} aria-label={tvl.label} className="ypn-range w-full" />
              <div className="flex justify-between text-[10px] text-ink-soft mt-1.5"><span>{fmtUSD(tvl.min)}</span><span>{fmtUSD(tvl.max)}</span></div>
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{apy.label}</span>
                <span className="font-atx-display text-[19px] font-medium text-coral2-deep tabular-nums">{apyVal.toFixed(1)}%</span>
              </div>
              <input type="range" min={apy.min} max={apy.max} step={apy.step} value={apyVal} onChange={(e) => setApyVal(Number(e.target.value))} aria-label={apy.label} className="ypn-range w-full" />
              <div className="flex justify-between text-[10px] text-ink-soft mt-1.5"><span>{apy.min}%</span><span>{apy.max}%</span></div>
            </div>
          </div>

          {/* Result */}
          <GradientPanel tone="lavender" className="p-7 flex flex-col justify-center">
            <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink/60">{YPN_CALCULATOR.resultLabel}</div>
            <div className="font-atx-display font-medium text-[clamp(2.4rem,5.6vw,3.4rem)] tracking-[-0.03em] leading-none mt-2 tabular-nums text-peri-deep">
              {fmtUSDFull(monthly)}
            </div>
            <div className="text-[12px] text-ink-mid mt-2">≈ {fmtUSDFull(annual)} {YPN_CALCULATOR.yearSuffix}</div>
            <div className="mt-5 pt-5 border-t border-[rgba(23,23,31,0.10)] flex items-center gap-2.5">
              <span className="w-[7px] h-[7px] rounded-full bg-peri shrink-0" />
              <span className="text-[11px] text-ink-mid">{YPN_CALCULATOR.principalLabel}: <b className="text-ink">{YPN_CALCULATOR.principalValue}</b></span>
            </div>
          </GradientPanel>
        </div>

        <p className="text-[10.5px] text-ink-soft leading-[1.5] mt-4 max-w-[70ch]">{YPN_CALCULATOR.disclaimer}</p>
      </div>
    </section>
  )
}

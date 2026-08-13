'use client'

// YieldCalculatorWidget — illustrative estimator. Pure local state (two sliders),
// no wallet/app hooks. Formula: Monthly Budget = (TVL * APY) / 12.

import { useState } from 'react'
import { YPN_CALCULATOR } from '@/constants/ypn-landing'

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

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
    <section className="border-b border-atx-ink [&_*]:rounded-none">
      <div className="mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 max-[800px]:py-[40px]">
        <div className={LABEL}>{YPN_CALCULATOR.eyebrow}</div>
        <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.05] text-[clamp(24px,3.6vw,40px)] mt-3 max-w-[20ch]">
          {YPN_CALCULATOR.title}
        </h2>
        <p className="text-atx-ink/65 text-[15px] leading-[1.5] mt-4 max-w-[60ch]">{YPN_CALCULATOR.sub}</p>

        <div className="mt-8 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4 max-[860px]:grid-cols-1">
          {/* Inputs */}
          <div className="border border-atx-ink bg-atx-panel p-6 flex flex-col gap-7">
            {/* TVL */}
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <span className={`${LABEL} text-[10px]`}>{tvl.label}</span>
                <span className="font-atx-mono text-[18px] font-bold text-atx-blue tabular-nums">{fmtUSD(tvlVal)}</span>
              </div>
              <input
                type="range"
                min={tvl.min}
                max={tvl.max}
                step={tvl.step}
                value={tvlVal}
                onChange={(e) => setTvlVal(Number(e.target.value))}
                aria-label={tvl.label}
                className="ypn-range w-full"
              />
              <div className="flex justify-between font-atx-mono text-[10px] text-atx-ink/40 mt-1.5">
                <span>{fmtUSD(tvl.min)}</span>
                <span>{fmtUSD(tvl.max)}</span>
              </div>
            </div>

            {/* APY */}
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <span className={`${LABEL} text-[10px]`}>{apy.label}</span>
                <span className="font-atx-mono text-[18px] font-bold text-atx-coral tabular-nums">{apyVal.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={apy.min}
                max={apy.max}
                step={apy.step}
                value={apyVal}
                onChange={(e) => setApyVal(Number(e.target.value))}
                aria-label={apy.label}
                className="ypn-range w-full"
              />
              <div className="flex justify-between font-atx-mono text-[10px] text-atx-ink/40 mt-1.5">
                <span>{apy.min}%</span>
                <span>{apy.max}%</span>
              </div>
            </div>
          </div>

          {/* Result */}
          <div className="border border-atx-ink bg-atx-ink text-atx-bone p-6 flex flex-col justify-center">
            <div className="font-atx-mono uppercase tracking-[0.14em] text-[10px] text-atx-bone/55">{YPN_CALCULATOR.resultLabel}</div>
            <div className="font-atx-display font-bold text-[clamp(34px,6vw,52px)] tracking-[-0.02em] leading-none mt-2 tabular-nums text-atx-acid">
              {fmtUSDFull(monthly)}
            </div>
            <div className="font-atx-mono text-[12px] text-atx-bone/55 mt-2">
              ≈ {fmtUSDFull(annual)} / year in campaign yield
            </div>
            <div className="mt-5 pt-5 border-t border-atx-bone/15 flex items-center gap-2.5">
              <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-bone shrink-0" />
              <span className="font-atx-mono text-[11px] text-atx-bone/70">
                {YPN_CALCULATOR.principalLabel}: <b className="text-atx-bone">{YPN_CALCULATOR.principalValue}</b>
              </span>
            </div>
          </div>
        </div>

        <p className="font-atx-mono text-[10.5px] text-atx-ink/45 leading-[1.5] mt-4 max-w-[70ch]">
          {YPN_CALCULATOR.disclaimer}
        </p>
      </div>
    </section>
  )
}

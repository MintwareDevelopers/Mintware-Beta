'use client'

import { useEffect, useState } from 'react'

// Growth of $10,000 over 5 years at today's rates.
// A Mintware market blends two sources: trading fees on the capital in the pool, and idle yield on the rest.
// Modeled conservatively: 60% in the pool at a 10% fee rate (a fifth of the live 30-day WETH/USDC average)
// and 40% idle at the live 30-day curated USDC lending rate from /api/benchmarks/yields.
const IN_POOL = 0.6
const FEE_RATE = 10
const SAVINGS = 0.38 // FDIC national average savings rate, May 2026
const TBILL = 3.6 // 3-month T-bill, FRED TB3MS, 2026
const START = 10_000
const YEARS = 5

type Series = { label: string; sub: string; rate: number; color: string; strong?: boolean }

export function GrowthChart() {
  const [lending, setLending] = useState<number | null>(null)
  useEffect(() => {
    fetch('/api/benchmarks/yields').then(r => r.json()).then(d => {
      const row = d?.ok && Array.isArray(d.rows) ? d.rows.find((x: { key: string }) => x.key === 'usdc-floor') : null
      const r = row?.apyMean30d ?? row?.apyBase
      if (typeof r === 'number' && r > 0 && r < 30) setLending(r)
    }).catch(() => {})
  }, [])
  if (lending === null) return null

  const blended = IN_POOL * FEE_RATE + (1 - IN_POOL) * lending
  const series: Series[] = [
    { label: 'Mintware market', sub: 'Trading fees + idle yield', rate: blended, color: 'var(--color-peri-deep)', strong: true },
    { label: 'Lending only', sub: 'Curated USDC lending', rate: lending, color: '#A9B6FC' },
    { label: '3-month T-bills', sub: 'US Treasury', rate: TBILL, color: '#9AA0B4' },
    { label: 'Savings account', sub: 'National average', rate: SAVINGS, color: '#C9CCD8' },
  ]
  const W = 640, H = 300, P = 40
  const months = Array.from({ length: YEARS * 12 + 1 }, (_, i) => i)
  const value = (rate: number, m: number) => START * Math.pow(1 + rate / 100 / 12, m)
  const max = value(blended, YEARS * 12) * 1.01, min = START * 0.995
  const x = (m: number) => P + (m / (YEARS * 12)) * (W - P * 2)
  const y = (v: number) => H - P - ((v - min) / (max - min)) * (H - P * 2)
  const path = (rate: number) => months.map((m, i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(value(rate, m)).toFixed(1)}`).join(' ')
  const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
  const end = (rate: number) => value(rate, YEARS * 12)

  return (
    <div className="grid lg:grid-cols-[1.5fr_1fr] gap-8 items-center">
      <div className="soft-card p-6 max-[800px]:p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Growth of $10,000 over 5 years">
          <defs><linearGradient id="mw-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5A57DE" stopOpacity=".18" /><stop offset="100%" stopColor="#5A57DE" stopOpacity="0" /></linearGradient></defs>
          {[0, 0.5, 1].map(f => <line key={f} x1={P} x2={W - P} y1={P + f * (H - P * 2)} y2={P + f * (H - P * 2)} stroke="rgba(23,23,31,.07)" />)}
          <path d={`${path(blended)} L${x(YEARS * 12)},${H - P} L${x(0)},${H - P} Z`} fill="url(#mw-area)" />
          {series.slice().reverse().map(s => <path key={s.label} d={path(s.rate)} fill="none" stroke={s.color} strokeWidth={s.strong ? 3.5 : 2} strokeLinecap="round" />)}
          {series.map(s => <circle key={s.label} cx={x(YEARS * 12)} cy={y(end(s.rate))} r={s.strong ? 5 : 3.5} fill={s.color} />)}
          <text x={P} y={H - 12} fontSize="12" fill="#8A8C9E">Today</text>
          <text x={W - P} y={H - 12} fontSize="12" fill="#8A8C9E" textAnchor="end">{YEARS} years</text>
        </svg>
      </div>
      <div className="space-y-3">
        {series.map(s => <div key={s.label} className={`rounded-2xl p-5 flex items-center justify-between ${s.strong ? 'glass-card' : 'bg-white border border-hair'}`}>
          <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full" style={{ background: s.color }} /><div><div className="text-[14px] font-semibold">{s.label}</div><div className="text-[12px] text-ink-mid">{s.sub} · {s.rate.toFixed(2)}%</div></div></div>
          <div className={`font-atx-display font-medium tracking-[-0.02em] ${s.strong ? 'text-[26px]' : 'text-[19px] text-ink-mid'}`}>{money(end(s.rate))}</div>
        </div>)}
        <p className="text-[11.5px] text-ink-soft pt-1 leading-[1.5]">Modeled at today’s rates. Mintware market: 60% in the pool at a 10% fee rate, 40% idle at curated USDC lending (DefiLlama, 30-day average). T-bills: FRED. Savings: FDIC national average.</p>
      </div>
    </div>
  )
}

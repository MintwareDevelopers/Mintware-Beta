'use client'

import { useEffect, useState } from 'react'

// Growth of $10,000 over 5 years at today's rates. Savings and T-bill rates are the latest published
// figures; the Earn line uses the live 30-day average of curated USDC lending from /api/benchmarks/yields.
const SAVINGS = 0.38 // FDIC national average savings rate, May 2026
const TBILL = 3.6 // 3-month T-bill, FRED TB3MS, 2026
const START = 10_000

type Series = { label: string; rate: number; color: string; strong?: boolean }

export function GrowthChart() {
  const [earnRate, setEarnRate] = useState<number | null>(null)
  useEffect(() => {
    fetch('/api/benchmarks/yields').then(r => r.json()).then(d => {
      const row = d?.ok && Array.isArray(d.rows) ? d.rows.find((x: { key: string }) => x.key === 'usdc-floor') : null
      const r = row?.apyMean30d ?? row?.apyBase
      if (typeof r === 'number' && r > 0 && r < 30) setEarnRate(r)
    }).catch(() => {})
  }, [])
  if (earnRate === null) return null

  const series: Series[] = [
    { label: 'Mintware Earn', rate: earnRate, color: 'var(--color-peri-deep)', strong: true },
    { label: '3-month T-bills', rate: TBILL, color: '#9AA0B4' },
    { label: 'Savings account', rate: SAVINGS, color: '#C9CCD8' },
  ]
  const W = 640, H = 300, P = 40
  const YEARS = 5
  const months = Array.from({ length: YEARS * 12 + 1 }, (_, i) => i)
  const value = (rate: number, m: number) => START * Math.pow(1 + rate / 100 / 12, m)
  const max = value(earnRate, YEARS * 12) * 1.01, min = START * 0.998
  const x = (m: number) => P + (m / (YEARS * 12)) * (W - P * 2)
  const y = (v: number) => H - P - ((v - min) / (max - min)) * (H - P * 2)
  const path = (rate: number) => months.map((m, i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(value(rate, m)).toFixed(1)}`).join(' ')
  const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`

  return (
    <div className="grid lg:grid-cols-[1.5fr_1fr] gap-8 items-center">
      <div className="soft-card p-6 max-[800px]:p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Growth of $10,000 over 5 years">
          {[0, 0.5, 1].map(f => <line key={f} x1={P} x2={W - P} y1={P + f * (H - P * 2)} y2={P + f * (H - P * 2)} stroke="rgba(23,23,31,.07)" />)}
          {series.slice().reverse().map(s => <path key={s.label} d={path(s.rate)} fill="none" stroke={s.color} strokeWidth={s.strong ? 3.5 : 2} strokeLinecap="round" />)}
          {series.map(s => <circle key={s.label} cx={x(YEARS * 12)} cy={y(value(s.rate, YEARS * 12))} r={s.strong ? 5 : 3.5} fill={s.color} />)}
          <text x={P} y={H - 12} fontSize="12" fill="#8A8C9E">Today</text>
          <text x={W - P} y={H - 12} fontSize="12" fill="#8A8C9E" textAnchor="end">5 years</text>
        </svg>
      </div>
      <div className="space-y-3">
        {series.map(s => <div key={s.label} className={`rounded-2xl p-5 flex items-center justify-between ${s.strong ? 'glass-card' : 'bg-white border border-hair'}`}>
          <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full" style={{ background: s.color }} /><div><div className="text-[14px] font-semibold">{s.label}</div><div className="text-[12px] text-ink-mid">{s.rate.toFixed(2)}% today</div></div></div>
          <div className={`font-atx-display font-medium tracking-[-0.02em] ${s.strong ? 'text-[26px]' : 'text-[20px] text-ink-mid'}`}>{money(value(s.rate, YEARS * 12))}</div>
        </div>)}
        <p className="text-[11.5px] text-ink-soft pt-1">Modeled from current rates: curated USDC lending (DefiLlama, 30-day average), 3-month T-bills (FRED), FDIC national savings average.</p>
      </div>
    </div>
  )
}

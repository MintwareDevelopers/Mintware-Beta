'use client'

import { useEffect, useState } from 'react'
import { GrowthChart } from '@/components/marketing/GrowthChart'

// The /the-math calculator. A Mintware market blends two sources on one balance: trading fees on the
// share that sits in the pool, and lending yield on the share that sits idle beside it.
// blended = inPool × feeRate + (1 − inPool) × lending. Lending and the live pool fee rate come from
// /api/benchmarks/yields (DefiLlama, 30-day averages); T-bills and savings are fixed public benchmarks.
const SAVINGS = 0.38 // FDIC national average savings rate, May 2026
const TBILL = 3.6 // 3-month T-bill, FRED TB3MS, 2026
const AMOUNTS = [1_000, 10_000, 50_000, 250_000]

type Row = { key: string; label: string; apyBase: number | null; apyMean30d: number | null; tvlUsd: number }
type Feed = { ok: true; rows: Row[]; asOf: string } | { ok: false }

const rate = (r: Row | undefined) => r?.apyMean30d ?? r?.apyBase ?? null
const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
const pct = (v: number) => `${v.toFixed(v >= 100 ? 0 : 2)}%`

export function MathCalculator() {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [amount, setAmount] = useState(10_000)
  const [inPool, setInPool] = useState(60)
  const [preset, setPreset] = useState<'conservative' | 'typical' | 'live'>('conservative')

  useEffect(() => {
    let alive = true
    fetch('/api/benchmarks/yields').then(r => r.json()).then(d => { if (alive) setFeed(d) }).catch(() => { if (alive) setFeed({ ok: false }) })
    return () => { alive = false }
  }, [])

  const rows = feed?.ok ? feed.rows : []
  const lendingRaw = rate(rows.find(r => r.key === 'usdc-floor'))
  const lending = lendingRaw != null && lendingRaw > 0 && lendingRaw < 30 ? lendingRaw : null
  const liveFee = rate(rows.find(r => r.key === 'eth-fees'))
  const presets = [
    { key: 'conservative' as const, label: 'Conservative', sub: 'A quiet market', v: 10 },
    { key: 'typical' as const, label: 'Typical', sub: 'A busy market', v: 25 },
    ...(liveFee != null && liveFee > 0 ? [{ key: 'live' as const, label: 'Live ETH/USDC', sub: '30-day average', v: liveFee }] : []),
  ]
  const fee = (presets.find(p => p.key === preset) ?? presets[0]).v
  const share = inPool / 100
  const blended = lending != null ? share * fee + (1 - share) * lending : null

  const compare = blended != null && lending != null ? [
    { label: 'Mintware market', rate: blended, strong: true },
    { label: 'Lending only', rate: lending },
    { label: '3-month T-bills', rate: TBILL },
    { label: 'Savings account', rate: SAVINGS },
  ] : []
  const top = compare.length ? Math.max(...compare.map(c => c.rate)) : 1

  return (
    <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6">
      <div className="glass-card p-8 max-[800px]:p-5">
        <div className="text-[13px] font-semibold">Your amount</div>
        <div className="font-atx-display font-medium text-[clamp(2.2rem,5vw,3rem)] tracking-[-0.03em] mt-2">{money(amount)}</div>
        <input type="range" min={500} max={500_000} step={500} value={amount} onChange={e => setAmount(Number(e.target.value))}
          aria-label="Amount" className="w-full mt-3 accent-[var(--color-peri-deep)]" />
        <div className="flex flex-wrap gap-2 mt-3">
          {AMOUNTS.map(v => <button key={v} type="button" onClick={() => setAmount(v)}
            className={`glass-pill !px-3 !py-1.5 text-[12.5px] ${amount === v ? 'glass-pill-primary' : ''}`}>{money(v)}</button>)}
        </div>

        <div className="mt-8 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">Time in the pool</span>
          <span className="font-mono text-[13px] text-ink-mid">{inPool}% in pool · {100 - inPool}% idle</span>
        </div>
        <input type="range" min={30} max={80} step={5} value={inPool} onChange={e => setInPool(Number(e.target.value))}
          aria-label="Share of time in the pool" className="w-full mt-3 accent-[var(--color-peri-deep)]" />
        <div className="flex justify-between text-[11.5px] text-ink-soft mt-1"><span>Quiet market</span><span>Busy market</span></div>

        <div className="mt-8 text-[13px] font-semibold">Pool fee rate</div>
        <div className="grid grid-cols-3 max-[520px]:grid-cols-1 gap-2 mt-3">
          {presets.map(p => <button key={p.key} type="button" onClick={() => setPreset(p.key)}
            className={`rounded-2xl p-3 text-left border transition ${preset === p.key ? 'border-[var(--color-peri-deep)] bg-white' : 'border-hair bg-white/60 hover:bg-white'}`}>
            <div className="text-[13px] font-semibold">{p.label}</div>
            <div className="font-atx-display font-medium text-[20px] tracking-[-0.02em] mt-0.5">{pct(p.v)}</div>
            <div className="text-[11.5px] text-ink-soft">{p.sub}</div>
          </button>)}
        </div>
      </div>

      <div className="glass-card p-8 max-[800px]:p-5 flex flex-col">
        <div className="text-[13px] font-semibold">Blended return</div>
        <div className="font-atx-display font-medium text-[clamp(3rem,7vw,4.6rem)] tracking-[-0.04em] leading-none mt-2 bg-clip-text text-transparent"
          style={{ backgroundImage: 'linear-gradient(120deg, var(--color-peri-deep), var(--color-coral2))' }}>
          {blended != null ? pct(blended) : '—'}
        </div>
        <div className="text-[15px] text-ink-mid mt-3">
          {blended != null ? <>About <b className="text-ink">{money(amount * blended / 100)}</b> a year on {money(amount)}.</> : feed?.ok === false ? 'Live rates are unavailable right now.' : 'Loading live rates…'}
        </div>
        <div className="space-y-3 mt-8">
          {compare.map(c => <div key={c.label}>
            <div className="flex justify-between text-[13px]"><span className={c.strong ? 'font-semibold' : 'text-ink-mid'}>{c.label}</span><span className="font-mono">{pct(c.rate)} · {money(amount * c.rate / 100)}/yr</span></div>
            <div className="h-2.5 rounded-full bg-white/70 mt-1.5 overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(2, c.rate / top * 100)}%`, background: c.strong ? 'linear-gradient(90deg, var(--color-peri-deep), var(--color-coral2))' : '#C9CCD8' }} />
            </div>
          </div>)}
        </div>
        <p className="text-[11.5px] text-ink-soft mt-auto pt-6 leading-[1.5]">Modeled at today’s rates. Lending and pool fees: DefiLlama, 30-day averages. T-bills: FRED. Savings: FDIC national average.</p>
      </div>

      {lending != null && <div className="lg:col-span-2 mt-4">
        <GrowthChart inPool={share} feeRate={fee} start={amount} lending={lending} caption={false} />
      </div>}
    </div>
  )
}

/** Live benchmark rows behind the model. */
export function BenchmarkTable() {
  const [rows, setRows] = useState<Row[] | null>(null)
  useEffect(() => {
    fetch('/api/benchmarks/yields').then(r => r.json()).then(d => setRows(d?.ok ? d.rows : [])).catch(() => setRows([]))
  }, [])
  const live = (rows ?? []).filter(r => r.key === 'usdc-floor' || r.key === 'eth-fees' || r.key === 'usdc-fees')
  const all = [
    ...live.map(r => ({ name: r.label, kind: r.key === 'usdc-floor' ? 'Idle yield' : 'Trading fees', v: rate(r), src: 'DefiLlama · 30-day' })),
    { name: '3-month T-bills', kind: 'Benchmark', v: TBILL, src: 'FRED' },
    { name: 'Savings account', kind: 'Benchmark', v: SAVINGS, src: 'FDIC national average' },
  ]
  return (
    <div className="soft-card mt-12 overflow-hidden">
      <div className="grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr] max-[700px]:grid-cols-[1.4fr_0.8fr] px-6 py-3 text-[12px] text-ink-soft border-b border-hair">
        <span>Source</span><span className="max-[700px]:hidden">Type</span><span className="text-right">Rate</span><span className="max-[700px]:hidden text-right">Data</span>
      </div>
      {all.map(r => <div key={r.name} className="grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr] max-[700px]:grid-cols-[1.4fr_0.8fr] px-6 py-4 border-b border-hair-soft last:border-0 items-center">
        <span className="text-[14.5px] font-semibold">{r.name}</span>
        <span className="max-[700px]:hidden"><span className="text-[12px] rounded-full bg-ground-cool px-2.5 py-1">{r.kind}</span></span>
        <span className="text-right font-mono text-[14px] text-mw-green font-semibold">{r.v != null ? pct(r.v) : '—'}</span>
        <span className="max-[700px]:hidden text-right text-[12.5px] text-ink-mid">{r.src}</span>
      </div>)}
    </div>
  )
}

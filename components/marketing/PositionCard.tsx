'use client'

import { useEffect, useState } from 'react'

// Simulated walkthrough of one MarketEngine position moving through its three states.
// Illustrative figures only — the card is tagged "Simulated".
const STATES = [
  { label: 'Market is busy', note: 'Most of your capital is in the pool, earning on every trade.', pool: 80, yieldPct: 20 },
  { label: 'Market is quiet', note: 'What the market doesn’t need moves into yield and keeps earning.', pool: 30, yieldPct: 70 },
  { label: 'You leave', note: 'Out instantly, with your share of both assets.', pool: 0, yieldPct: 0 },
] as const

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function PositionCard() {
  const [step, setStep] = useState(0)
  const [earned, setEarned] = useState(0)

  useEffect(() => {
    const cycle = window.setInterval(() => setStep(s => (s + 1) % STATES.length), 3600)
    const tick = window.setInterval(() => setEarned(e => (e > 38 ? 0 : e + 0.07)), 120)
    return () => { window.clearInterval(cycle); window.clearInterval(tick) }
  }, [])

  const s = STATES[step]
  const leaving = step === 2
  return (
    <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-6 max-w-[460px] w-full">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold">Your $5,000 · stock token / USDG</span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">Simulated</span>
      </div>
      <div className="mt-5 flex gap-1.5" aria-hidden>
        {STATES.map((x, i) => <span key={x.label} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${i === step ? 'bg-peri-deep' : 'bg-hair'}`} />)}
      </div>
      <div className="mt-5 min-h-[140px]">
        <div className="font-atx-display font-semibold text-[20px] tracking-[-0.02em]">{s.label}</div>
        <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-1.5">{s.note}</p>
        {leaving ? (
          <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-lg bg-ground-cool p-3"><div className="text-ink-mid">You receive</div><div className="font-mono font-semibold mt-1">2,531.40 USDG</div></div>
            <div className="rounded-lg bg-ground-cool p-3"><div className="text-ink-mid">and</div><div className="font-mono font-semibold mt-1">13.92 stock tokens</div></div>
          </div>
        ) : (
          <div className="mt-4 space-y-2.5 text-[13px]">
            <Bar label="In the market" pct={s.pool} />
            <Bar label="Earning yield" pct={s.yieldPct} />
          </div>
        )}
      </div>
      <div className="mt-4 pt-4 border-t border-hair-soft flex items-center justify-between text-[13px]">
        <span className="text-ink-mid">Earned so far</span>
        <span className="font-mono font-semibold text-mw-green">+${fmt(earned)}</span>
      </div>
    </div>
  )
}

function Bar({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-ink-mid"><span>{label}</span><span className="font-mono">${fmt(5000 * pct / 100)}</span></div>
      <div className="mt-1 h-2 rounded-full bg-ground-cool overflow-hidden"><div className="h-full rounded-full bg-peri-deep transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

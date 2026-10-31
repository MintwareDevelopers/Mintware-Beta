'use client'

import { useEffect, useState } from 'react'

// Simulated walkthrough of one liquidity position: capital deployed into the pool, capital still staged, and an
// exit. Illustrative figures only — the card is tagged "Simulated". Staged capital is part of the position's
// value but is not promised to earn, so the copy never says it does.
const STATES = [
  { label: 'Deployed into the pool', note: 'Most of your capital is in the market’s pool, earning a share of the fee on every trade.', pool: 80, staged: 20 },
  { label: 'Waiting to be deployed', note: 'New capital sits staged until the market deploys it. It still counts toward your share.', pool: 45, staged: 55 },
  { label: 'You leave', note: 'Exit whenever you want, paid out pro‑rata in both of the market’s assets.', pool: 0, staged: 0 },
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
    <div className="relative w-full max-w-[460px]">
      <div aria-hidden="true" className="absolute inset-[10%_-8%_-8%_8%] rounded-[40px] opacity-35 blur-[48px]" style={{ background: 'var(--mw-sheen)' }} />
      <div className="mw-raise-lg relative rounded-[28px] p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px] font-semibold">Your $5,000 · stock token / USDG</span>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: 'var(--mw-band)', color: 'var(--mw-ink-2)' }}>Simulated</span>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-1.5" aria-hidden>
          {STATES.map((x, i) => <span key={x.label} className="h-1.5 rounded-full transition-colors duration-500" style={{ background: i === step ? 'var(--mw-btn)' : 'var(--mw-well)', boxShadow: i === step ? 'none' : 'var(--mw-inset)' }} />)}
        </div>
        <div className="mt-5 min-h-[150px]" aria-live="polite">
          <div className="font-semibold text-[20px] tracking-[-0.02em]">{s.label}</div>
          <p className="text-[14px] text-ink-mid leading-[1.55] mt-1.5 mb-0">{s.note}</p>
          {leaving ? (
            <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
              <div className="rounded-[16px] p-3.5" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}><div className="text-ink-soft">You receive</div><div className="font-geist-mono font-medium mt-1">2,531.40 USDG</div></div>
              <div className="rounded-[16px] p-3.5" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}><div className="text-ink-soft">and</div><div className="font-geist-mono font-medium mt-1">13.92 stock tokens</div></div>
            </div>
          ) : (
            <div className="mt-4 space-y-3 text-[13px]">
              <Bar label="In the market" pct={s.pool} />
              <Bar label="Staged" pct={s.staged} dots />
            </div>
          )}
        </div>
        <div className="mt-4 rounded-[16px] px-4 py-3 flex items-center justify-between text-[13px]" style={{ background: 'var(--mw-band)' }}>
          <span className="text-ink-mid">Fees earned so far</span>
          <span className="font-geist-mono font-medium text-[15px]" style={{ color: 'var(--mw-gain)' }}>+${fmt(earned)}</span>
        </div>
      </div>
    </div>
  )
}

function Bar({ label, pct, dots }: { label: string; pct: number; dots?: boolean }) {
  return (
    <div>
      <div className="flex justify-between text-ink-mid"><span>{label}</span><span className="font-geist-mono">${fmt(5000 * pct / 100)}</span></div>
      <div className="mt-1.5 h-3 rounded-full overflow-hidden" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
        <div className={`h-full rounded-full transition-[width] duration-700 ${dots ? 'mw-tex-dots' : ''}`} style={{ width: `${pct}%`, backgroundColor: dots ? '#C9C0F4' : '#7C7AF0' }} />
      </div>
    </div>
  )
}

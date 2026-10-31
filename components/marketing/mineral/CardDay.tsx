'use client'

// "A day with the card": a stepped timeline. Picking a moment moves two levels — the small card balance you
// spend from, and the earning balance it refills from — so the refill rule (only what you spent, within your
// limit) is something you watch happen. Illustrative figures; the card is not live.

import { useState, type ReactNode } from 'react'
import { IconCard, IconLimit } from '@/components/ui2/MineralIcons'

const CARD_MAX = 500
const MOMENTS = [
  { time: '08:00', title: 'Morning', body: 'Your card balance is topped up. Everything else is in your earning balance.', card: 500, earning: 2480, tag: null },
  { time: '08:42', title: 'Coffee · $6.75', body: 'You tap to pay. It comes out of the card balance, nothing else moves.', card: 493.25, earning: 2480, tag: 'spend' },
  { time: '12:30', title: 'Lunch · $18.40', body: 'Another purchase, same as any card.', card: 474.85, earning: 2480, tag: 'spend' },
  { time: '18:00', title: 'Refill · $25.15', body: 'Exactly what you spent moves from your earning balance back to the card, within the daily limit you set.', card: 500, earning: 2454.85, tag: 'refill' },
  { time: 'Overnight', title: 'The rest stays put', body: 'The other $2,454.85 never left. It stays in your earning balance, in your own wallet.', card: 500, earning: 2454.85, tag: null },
] as const

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function Level({ label, value, pct, tone, icon, delta }: { label: string; value: number; pct: number; tone: string; icon: ReactNode; delta?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5 text-[14px] text-ink-mid">
          <span className="w-9 h-9 rounded-[10px] grid place-items-center" style={{ color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}>{icon}</span>{label}
        </span>
        <span className="flex items-baseline gap-2">
          {delta && <span className="font-geist-mono text-[12.5px] font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'var(--mw-band)', color: 'var(--mw-peri-deep)' }}>{delta}</span>}
          <span className="font-geist-mono text-[22px] tracking-[-0.02em]">{money(value)}</span>
        </span>
      </div>
      <div className="mt-3 h-4 rounded-full overflow-hidden" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  )
}

export function CardDay() {
  const [i, setI] = useState(0)
  const m = MOMENTS[i]
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.05fr] items-start">
      <ol className="m-0 p-0 list-none flex flex-col" aria-label="A day with the card">
        {MOMENTS.map((x, k) => {
          const on = k === i
          return (
            <li key={x.time} className="flex gap-4">
              <div className="flex flex-col items-center pt-4">
                <span className="w-3 h-3 rounded-full shrink-0 transition-colors" style={{ background: on ? 'var(--mw-btn)' : k < i ? '#A9A7FA' : 'var(--mw-well)', boxShadow: on ? '0 0 0 5px rgba(91,91,230,.16)' : 'var(--mw-inset)' }} />
                {k < MOMENTS.length - 1 && <span className="w-px flex-1 my-1.5" style={{ background: 'var(--mw-line)' }} />}
              </div>
              <button
                type="button"
                onClick={() => setI(k)}
                aria-pressed={on}
                className="flex-1 text-left rounded-[18px] px-5 py-4 mb-2.5 border-0 cursor-pointer transition-[box-shadow,background] duration-200"
                style={on ? { background: '#fff', boxShadow: 'var(--mw-raise)' } : { background: 'transparent' }}
              >
                <span className="flex items-center gap-3">
                  <span className="font-geist-mono text-[12.5px] text-ink-soft w-[74px] shrink-0">{x.time}</span>
                  <span className="font-semibold text-[16px]">{x.title}</span>
                  {x.tag && <span className={`ml-auto text-[11.5px] font-semibold px-2 py-0.5 rounded-full ${x.tag === 'refill' ? 'bg-[#EDE9FB] text-[#4643D1]' : 'bg-[#F2F2F5] text-ink-mid'}`}>{x.tag === 'refill' ? 'Auto-refill' : 'Purchase'}</span>}
                </span>
                {on && <span className="block text-[14.5px] text-ink-mid leading-[1.5] mt-2 sm:pl-[86px]">{x.body}</span>}
              </button>
            </li>
          )
        })}
      </ol>

      <div className="lg:sticky lg:top-24 mw-raise-lg rounded-[26px] p-[clamp(20px,3vw,30px)] relative overflow-hidden" aria-live="polite">
        <div aria-hidden="true" className="absolute -right-24 -top-28 w-72 h-72 rounded-full opacity-25 blur-[50px]" style={{ background: 'var(--mw-sheen)' }} />
        <div className="relative flex items-center justify-between">
          <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft">{m.time}</span>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: 'var(--mw-band)', color: 'var(--mw-ink-2)' }}>Illustration</span>
        </div>
        <div className="relative mt-6 flex flex-col gap-7">
          <Level label="Card balance" value={m.card} pct={(m.card / CARD_MAX) * 100} tone="#7C7AF0" icon={<IconCard size={18} />} delta={i > 0 && m.card !== MOMENTS[i - 1].card ? `${m.card > MOMENTS[i - 1].card ? '+' : '−'}${money(Math.abs(m.card - MOMENTS[i - 1].card))}` : undefined} />
          <Level label="Earning balance" value={m.earning} pct={(m.earning / 2480) * 100} tone="#C9C0F4" icon={<IconLimit size={18} />} delta={i > 0 && m.earning !== MOMENTS[i - 1].earning ? `−${money(MOMENTS[i - 1].earning - m.earning)}` : undefined} />
        </div>
        <div className="relative mt-7 flex gap-2">
          <button type="button" onClick={() => setI((k) => Math.max(0, k - 1))} disabled={i === 0} className="mw-btn-quiet flex-1 disabled:opacity-40 disabled:cursor-default">Back</button>
          <button type="button" onClick={() => setI((k) => (k + 1) % MOMENTS.length)} className="mw-btn flex-1">{i === MOMENTS.length - 1 ? 'Start over' : 'Next moment'}</button>
        </div>
      </div>
    </div>
  )
}

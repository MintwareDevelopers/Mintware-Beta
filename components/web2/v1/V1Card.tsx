'use client'

// Card lane — the spend side of the platform: a card balance that refills itself from the holder's earning
// balance. Illustrative throughout (Bridge + Stripe issuing and the refill gateway are not live), so the
// header carries the Simulated chip and nothing here moves funds.

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { CardVisual } from '@/components/marketing/CardVisual'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { GlassFrame } from './GlassFrame'
import { LaneHeader, Label, PLAIN } from './LaneHeader'
import { IconCard, IconHours, IconLimit } from '@/components/ui2/MineralIcons'

type Txn = { merchant: string; when: string; amount: number; refill?: number; kind: 'purchase' | 'refill' }
const TXNS: Txn[] = [
  { merchant: 'Blue Bottle Coffee', when: 'Today · 8:42', amount: 6.75, kind: 'purchase' },
  { merchant: 'Refill from earning balance', when: 'Today · 8:42', amount: 120, kind: 'refill' },
  { merchant: 'Delta Air Lines', when: 'Yesterday', amount: 412.3, kind: 'purchase' },
  { merchant: 'Refill from earning balance', when: 'Yesterday', amount: 400, kind: 'refill' },
  { merchant: 'Whole Foods Market', when: 'Oct 27', amount: 86.14, kind: 'purchase' },
  { merchant: 'Spotify', when: 'Oct 26', amount: 11.99, kind: 'purchase' },
  { merchant: 'Uber', when: 'Oct 26', amount: 23.4, kind: 'purchase' },
]

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function Tile({ children }: { children: ReactNode }) {
  return <span className="flex-none w-11 h-11 rounded-[12px] grid place-items-center" style={{ color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}>{children}</span>
}

export function V1Card() {
  const [earning, setEarning] = useState(24812.4)
  const [limit, setLimit] = useState(1000)
  const [frozen, setFrozen] = useState(false)
  useEffect(() => {
    const id = window.setInterval(() => setEarning((e) => e + 0.0031), 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div>
      <LaneHeader
        eyebrow="Card"
        title="Spend what"
        accent="you’ve earned."
        simulated
        lede="Your card spends from a small card balance that refills itself from your earning balance, only by what you spend. Everything else keeps working."
        actions={<Link href="/cards" className="mw-btn">Join the waitlist</Link>}
      />

      <div className="grid gap-5 mt-8 grid-cols-1 min-[960px]:grid-cols-[1.05fr_1fr]">
        <GradientPanel tone="coral" className="p-8 max-[640px]:p-4 min-h-[380px] flex items-center justify-center overflow-hidden">
          <div className="flex justify-center"><CardVisual label="Earning balance" amount="$24,812.40" /></div>
        </GradientPanel>

        <div className="flex flex-col gap-4">
          <div className="rounded-[20px] p-6 flex gap-4 items-start" style={PLAIN}>
            <Tile><IconHours size={22} /></Tile>
            <div className="min-w-0">
              <Label>Earning balance</Label>
              <div className="font-mono text-[34px] mt-1 tracking-[-0.03em]">{money(earning)}</div>
              <div className="text-[13px] mt-1" style={{ color: '#0F7A43' }}>Earning in a curated stablecoin market</div>
            </div>
          </div>
          <div className="rounded-[20px] p-5" style={PLAIN}>
            <div className="flex items-center gap-3">
              <Tile><IconCard size={22} /></Tile>
              <div className="flex-1 grid grid-cols-2 gap-4">
                <div><Label>Card balance</Label><div className="font-mono text-[22px] mt-1">$480.00</div></div>
                <div><Label>Refilled this month</Label><div className="font-mono text-[22px] mt-1">$1,240.00</div></div>
              </div>
            </div>
            {/* The card balance as a level in a well: solid is what's ready to spend, dotted is what the next refill tops up. */}
            <div className="mt-4 h-3.5 rounded-full overflow-hidden flex" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} aria-hidden="true">
              <div className="h-full rounded-l-full" style={{ width: '48%', background: '#7C7AF0' }} />
              <div className="h-full mw-tex-dots" style={{ width: '22%', backgroundColor: '#E1DBFA' }} />
            </div>
            <div className="flex justify-between text-[12.5px] mt-2" style={{ color: '#62626F' }}><span>Ready to spend</span><span>Only what you spent is refilled</span></div>
          </div>
          <div className="rounded-[20px] p-5" style={PLAIN}>
            <div className="flex items-center gap-3">
              <Tile><IconLimit size={22} /></Tile>
              <div className="flex-1 flex items-center justify-between">
                <Label>Daily refill limit</Label>
                <span className="font-mono text-[17px]">{money(limit)}</span>
              </div>
            </div>
            <input type="range" min={100} max={5000} step={100} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="mw-range w-full mt-4" style={{ ['--mw-fill' as string]: `${((limit - 100) / 4900) * 100}%` }} aria-label="Daily refill limit" />
            <div className="flex items-center justify-between mt-4">
              <span className="inline-flex items-center gap-2 text-[13px] font-semibold" style={{ color: frozen ? '#454552' : '#0F7A43' }}>
                <span className={`w-2 h-2 rounded-full ${frozen ? 'mw-tex-hatch' : ''}`} style={{ background: frozen ? '#D9D9E2' : '#22A45D' }} />{frozen ? 'Card frozen' : 'Card active'}
              </span>
              <button onClick={() => setFrozen((f) => !f)} aria-pressed={frozen} className="mw-btn-quiet !min-h-[40px]">{frozen ? 'Unfreeze' : 'Freeze card'}</button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <Label>Activity</Label>
        <GlassFrame className="mt-3">
          <ul className="m-0 p-0 list-none">
            {TXNS.map((t, i) => (
              <li key={i} className="flex items-center gap-4 px-5 py-3.5 text-[14px]" style={i ? { borderTop: '1px solid var(--mw-line)' } : undefined}>
                <span
                  className="flex-none w-10 h-10 rounded-full grid place-items-center text-[13px] font-semibold"
                  style={t.kind === 'refill'
                    ? { background: 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', color: '#2E2BA8', boxShadow: 'inset 0 1px 0 #fff' }
                    : { background: 'var(--mw-well)', color: '#454552', boxShadow: 'var(--mw-inset)' }}
                  aria-hidden="true"
                >
                  {t.kind === 'refill' ? '↺' : t.merchant.charAt(0)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{t.merchant}</span>
                  <span className="block text-[12.5px] mt-0.5" style={{ color: '#62626F' }}>{t.when} · {t.kind === 'refill' ? 'Auto-refill' : 'Purchase'}</span>
                </span>
                <span className="font-mono" style={{ color: t.kind === 'refill' ? '#0F7A43' : '#15151D' }}>
                  {t.kind === 'refill' ? '+' : '−'}{money(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        </GlassFrame>
      </div>

      <div className="mt-10">
        <Label>How it stays topped up</Label>
        <div className="mt-3">
          <FlowDiagram steps={[
            { label: 'Your balance earns', sub: 'Stablecoins in a curated market' },
            { label: 'You tap to pay', sub: 'From your card balance' },
            { label: 'Your card refills', sub: 'Only what you spent, within your limit' },
            { label: 'The rest keeps working', sub: 'Nothing else moves' },
          ]} />
        </div>
      </div>
    </div>
  )
}

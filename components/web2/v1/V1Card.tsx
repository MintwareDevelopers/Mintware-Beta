'use client'

// Card lane — the spend side of the platform: a card balance that refills itself from the holder's earning
// balance. Illustrative throughout (Bridge + Stripe issuing and the refill gateway are not live), so the
// header carries the Simulated chip and nothing here moves funds.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CardVisual } from '@/components/marketing/CardVisual'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { GlassFrame } from './GlassFrame'
import { LaneHeader, Label, PLAIN } from './LaneHeader'

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
        actions={<Link href="/cards" className="glass-pill-primary no-underline">Join the waitlist</Link>}
      />

      <div className="grid gap-5 mt-8 grid-cols-1 min-[960px]:grid-cols-[1.05fr_1fr]">
        <GradientPanel tone="coral" className="p-8 max-[640px]:p-4 min-h-[380px] flex items-center justify-center">
          <CardVisual label="Earning balance" amount="$24,812.40" />
        </GradientPanel>

        <div className="flex flex-col gap-4">
          <div className="rounded-[16px] p-6" style={PLAIN}>
            <Label>Earning balance</Label>
            <div className="font-mono font-bold text-[34px] mt-1.5 tracking-[-0.02em]">{money(earning)}</div>
            <div className="text-[13px] mt-1" style={{ color: '#16A34A' }}>Earning in a curated stablecoin market</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-[16px] p-5" style={PLAIN}>
              <Label>Card balance</Label>
              <div className="font-mono font-bold text-[24px] mt-1.5">$480.00</div>
              <div className="text-[12.5px] mt-1" style={{ color: '#8A8A9E' }}>Ready to spend</div>
            </div>
            <div className="rounded-[16px] p-5" style={PLAIN}>
              <Label>Refilled this month</Label>
              <div className="font-mono font-bold text-[24px] mt-1.5">$1,240.00</div>
              <div className="text-[12.5px] mt-1" style={{ color: '#8A8A9E' }}>Only what you spent</div>
            </div>
          </div>
          <div className="rounded-[16px] p-5" style={PLAIN}>
            <div className="flex items-center justify-between">
              <Label>Daily refill limit</Label>
              <span className="font-mono font-bold text-[15px]">{money(limit)}</span>
            </div>
            <input type="range" min={100} max={5000} step={100} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full mt-3 accent-[#5A57DE]" aria-label="Daily refill limit" />
            <div className="flex items-center justify-between mt-3">
              <span className="text-[13px]" style={{ color: '#494957' }}>{frozen ? 'Card frozen' : 'Card active'}</span>
              <button onClick={() => setFrozen((f) => !f)} className="glass-pill glass-pill-sm cursor-pointer">{frozen ? 'Unfreeze' : 'Freeze card'}</button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <Label>Activity</Label>
        <GlassFrame className="mt-3" innerClassName="overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[560px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.07em]" style={{ color: '#8A8A9E' }}>
                <th className="font-semibold px-5 py-3">Description</th>
                <th className="font-semibold px-5 py-3">When</th>
                <th className="font-semibold px-5 py-3">Type</th>
                <th className="font-semibold px-5 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {TXNS.map((t, i) => (
                <tr key={i} className="border-t border-white/70">
                  <td className="px-5 py-3.5 font-semibold">{t.merchant}</td>
                  <td className="px-5 py-3.5" style={{ color: '#494957' }}>{t.when}</td>
                  <td className="px-5 py-3.5">
                    <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-white/80" style={{ color: t.kind === 'refill' ? '#5A57DE' : '#494957' }}>
                      {t.kind === 'refill' ? 'Auto-refill' : 'Purchase'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono font-semibold" style={{ color: t.kind === 'refill' ? '#16A34A' : '#191923' }}>
                    {t.kind === 'refill' ? '+' : '−'}{money(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

'use client'

// Agents lane — pay-per-call for software. The quote step is LIVE: it calls Mintware's own x402 endpoint and
// shows the real 402 payment requirements it returns. Paying, the agent wallet and the call log are simulated.

import { useState } from 'react'
import Link from 'next/link'
import { GlassFrame } from './GlassFrame'
import { LaneHeader, Label, PLAIN } from './LaneHeader'

const DEMO_AGENT = '0x9c646C48a302f4725450669f1218d3FDb3e933AD'

type Quote = { amountUsd: number; network: string; payTo: string; description: string }
type Step = 'idle' | 'quoting' | 'quoted' | 'paying' | 'done' | 'error'

const CALLS = [
  { api: 'Market data · NVDA/USDG depth', price: 0.01, ms: 182, when: '12s ago' },
  { api: 'Mintware score · 0x41c…9e2', price: 0.01, ms: 96, when: '40s ago' },
  { api: 'Compute · 2 GPU-seconds', price: 0.04, ms: 1240, when: '2m ago' },
  { api: 'Mintware score · 0xa07…31b', price: 0.01, ms: 88, when: '3m ago' },
  { api: 'News feed · tokenized equities', price: 0.02, ms: 210, when: '6m ago' },
]

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function V1Agents() {
  const [step, setStep] = useState<Step>('idle')
  const [quote, setQuote] = useState<Quote | null>(null)

  const getQuote = async () => {
    setStep('quoting')
    try {
      const res = await fetch(`/api/x402/score?address=${DEMO_AGENT}`, { cache: 'no-store' })
      const j = await res.json()
      const a = res.status === 402 && Array.isArray(j?.accepts) ? j.accepts[0] : null
      if (!a) throw new Error('no_quote')
      setQuote({ amountUsd: Number(a.maxAmountRequired) / 1e6, network: a.network, payTo: a.payTo, description: a.description })
      setStep('quoted')
    } catch {
      setStep('error')
    }
  }
  const pay = () => {
    setStep('paying')
    window.setTimeout(() => setStep('done'), 1100)
  }

  return (
    <div>
      <LaneHeader
        eyebrow="Agents"
        title="Money built"
        accent="for agents."
        lede="Agents pay for data, compute and APIs per request in USDC, get paid the same way, and keep their balance earning between jobs."
        actions={<>
          <Link href="/agents/leaderboard" className="glass-pill no-underline">Agent leaderboard</Link>
          <Link href="/docs" className="glass-pill-primary no-underline">Start building</Link>
        </>}
      />

      <div className="grid gap-5 mt-8 grid-cols-1 min-[960px]:grid-cols-[1.15fr_1fr]">
        <div className="rounded-[16px] p-6" style={PLAIN}>
          <div className="flex items-center justify-between gap-3">
            <Label>Make a paid call</Label>
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: '#16A34A' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#16A34A' }} />Live quote
            </span>
          </div>
          <div className="mt-3 font-mono text-[12.5px] rounded-[10px] px-3 py-2.5 overflow-x-auto whitespace-nowrap" style={{ background: '#F7F7FB', border: '1px solid rgba(22,22,44,0.08)' }}>
            GET /api/x402/score?address={short(DEMO_AGENT)}
          </div>

          <ol className="mt-5 flex flex-col gap-3.5">
            <Row n={1} done={step !== 'idle' && step !== 'quoting' && step !== 'error'} title="Ask for the resource" body="The API answers 402 Payment Required with its price." />
            <Row
              n={2}
              done={step === 'quoted' || step === 'paying' || step === 'done'}
              title={quote ? `Price: $${quote.amountUsd.toFixed(2)} USDC on ${quote.network}` : 'Read the price'}
              body={quote ? `${quote.description} · paid to ${short(quote.payTo)}` : 'Read live from Mintware’s production endpoint.'}
            />
            <Row n={3} done={step === 'done'} title="Pay and receive" body={step === 'done' ? 'Paid in one signed USDC transfer. Result delivered.' : 'The agent signs one USDC authorization; no account, no API key.'} simulated />
          </ol>

          <div className="mt-6">
            {step === 'idle' || step === 'error' ? (
              <button onClick={getQuote} className="glass-pill-primary w-full">Get a live quote</button>
            ) : step === 'quoting' ? (
              <button disabled className="glass-pill-primary w-full opacity-60">Asking the API…</button>
            ) : step === 'quoted' ? (
              <button onClick={pay} className="glass-pill-primary w-full">Pay ${quote?.amountUsd.toFixed(2)} and call</button>
            ) : step === 'paying' ? (
              <button disabled className="glass-pill-primary w-full opacity-60">Settling…</button>
            ) : (
              <button onClick={() => { setStep('idle'); setQuote(null) }} className="glass-pill w-full cursor-pointer">Run it again</button>
            )}
            {step === 'error' && <p className="text-[12.5px] mt-2" style={{ color: '#DC4A44' }}>Couldn’t reach the endpoint. Try again.</p>}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-[16px] p-6" style={PLAIN}>
            <div className="flex items-center justify-between"><Label>Agent wallet</Label><SimTag /></div>
            <div className="font-mono font-bold text-[32px] mt-1.5 tracking-[-0.02em]">$1,240.18</div>
            <div className="text-[13px] mt-1" style={{ color: '#16A34A' }}>Earning between calls</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-[16px] p-5" style={PLAIN}><Label>Calls today</Label><div className="font-mono font-bold text-[24px] mt-1.5">3,412</div></div>
            <div className="rounded-[16px] p-5" style={PLAIN}><Label>Spent today</Label><div className="font-mono font-bold text-[24px] mt-1.5">$34.12</div></div>
          </div>
          <div className="rounded-[16px] p-5" style={PLAIN}>
            <Label>Identity</Label>
            <p className="text-[13.5px] mt-2 leading-[1.55]" style={{ color: '#494957' }}>
              Mintware is registered agent <b>#37297</b> on Base. Every agent can carry an on-chain identity and a track record.
            </p>
            <Link href="/agents/leaderboard" className="inline-block mt-2 text-[13px] font-semibold no-underline hover:underline" style={{ color: '#5A57DE' }}>See the leaderboard →</Link>
          </div>
        </div>
      </div>

      <div className="mt-10 flex items-center gap-3"><Label>Recent calls</Label><SimTag /></div>
      <GlassFrame className="mt-3" innerClassName="overflow-x-auto">
        <table className="w-full text-[13.5px] min-w-[560px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.07em]" style={{ color: '#8A8A9E' }}>
              <th className="font-semibold px-5 py-3">Call</th>
              <th className="font-semibold px-5 py-3 text-right">Price</th>
              <th className="font-semibold px-5 py-3 text-right">Latency</th>
              <th className="font-semibold px-5 py-3 text-right">When</th>
            </tr>
          </thead>
          <tbody>
            {CALLS.map((c, i) => (
              <tr key={i} className="border-t border-white/70">
                <td className="px-5 py-3.5 font-semibold">{c.api}</td>
                <td className="px-5 py-3.5 text-right font-mono">${c.price.toFixed(2)}</td>
                <td className="px-5 py-3.5 text-right font-mono" style={{ color: '#494957' }}>{c.ms} ms</td>
                <td className="px-5 py-3.5 text-right" style={{ color: '#8A8A9E' }}>{c.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassFrame>
    </div>
  )
}

function SimTag() {
  return <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full" style={{ color: '#8A8A9E', background: 'rgba(22,22,44,0.05)' }}>Simulated</span>
}

function Row({ n, done, title, body, simulated }: { n: number; done: boolean; title: string; body: string; simulated?: boolean }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0" style={done ? { background: '#16A34A', color: '#fff' } : { background: '#F0F0F6', color: '#8A8A9E' }}>
        {done ? '✓' : n}
      </span>
      <div>
        <div className="text-[14px] font-semibold">{title}{simulated && <span className="ml-2 align-middle"><SimTag /></span>}</div>
        <div className="text-[12.5px] mt-0.5" style={{ color: '#8A8A9E' }}>{body}</div>
      </div>
    </li>
  )
}

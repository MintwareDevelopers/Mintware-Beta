'use client'

// The /agents hero object: one paid HTTP call, x402-style, stepping through its four lines — ask, get a price
// (402), pay, get the result. Each line lights in turn so the handshake reads as a sequence. Example values.

import { useEffect, useState } from 'react'

const LINES = [
  { who: 'agent', verb: 'GET', text: '/api/x402/score?address=0x9c64…33AD', note: 'Your agent asks for something' },
  { who: 'api', verb: '402', text: 'Payment Required · 0.01 USDC · Base', note: 'The API names its price' },
  { who: 'agent', verb: 'PAY', text: 'Signed USDC transfer, attached to the retry', note: 'Your agent pays from its own wallet' },
  { who: 'api', verb: '200', text: '{ "score": 149, "tier": "bronze" }', note: 'And gets the result' },
] as const

export function AgentExchange() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setStep((s) => (s + 1) % (LINES.length + 1)), 1600)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="relative w-full max-w-[480px]">
      <div aria-hidden="true" className="absolute inset-[10%_-8%_-8%_8%] rounded-[40px] opacity-35 blur-[48px]" style={{ background: 'var(--mw-sheen)' }} />
      <div className="mw-raise-lg relative rounded-[28px] p-5" role="img" aria-label="Example of one paid API call: request, 402 price, signed payment, result">
        <div className="flex items-center justify-between px-1">
          <span className="text-[14px] font-semibold">One paid call</span>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: 'var(--mw-band)', color: 'var(--mw-ink-2)' }}>Example</span>
        </div>
        <ol className="mt-4 p-0 list-none flex flex-col gap-2.5">
          {LINES.map((l, i) => {
            const on = i < step
            const api = l.who === 'api'
            return (
              <li key={l.verb} className="rounded-[16px] px-4 py-3 transition-[opacity,box-shadow,background] duration-500"
                style={{ opacity: on ? 1 : 0.4, background: on ? (api ? 'var(--mw-ground)' : '#fff') : 'var(--mw-ground)', boxShadow: on ? (api ? 'var(--mw-inset)' : 'var(--mw-raise-sm)') : 'var(--mw-inset)', marginLeft: api ? 22 : 0, marginRight: api ? 0 : 22 }}>
                <div className="flex items-center gap-2.5">
                  <span className="font-geist-mono text-[11.5px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
                    style={l.verb === '402' ? { background: '#FBEEE7', color: '#9A3F1C' } : l.verb === '200' ? { background: '#E3F4EA', color: '#0F7A43' } : { background: 'var(--mw-band)', color: 'var(--mw-peri-deep)' }}>{l.verb}</span>
                  <span className="font-geist-mono text-[12.5px] truncate">{l.text}</span>
                </div>
                <div className="text-[12.5px] text-ink-soft mt-1.5">{l.note}</div>
              </li>
            )
          })}
        </ol>
        <div className="mt-4 flex items-center justify-between rounded-[14px] px-4 py-2.5 text-[12.5px]" style={{ background: 'var(--mw-band)' }}>
          <span className="text-ink-mid">No account, no API key, no invoice</span>
          <span className="font-geist-mono" style={{ color: 'var(--mw-peri-deep)' }}>x402</span>
        </div>
      </div>
    </div>
  )
}

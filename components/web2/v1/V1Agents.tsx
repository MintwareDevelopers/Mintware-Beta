'use client'

// Agents lane — pay-per-call for software. The quote step is LIVE: it calls Mintware's own x402 endpoint and
// shows the real 402 payment requirements it returns. Paying, the agent wallet and the call log are simulated.
// Mineral: one raised "paid call" console leads the screen; the request sits in an inset well, and each step of
// the handshake fills in as it happens. The wallet, stats and identity sit beside it; the call log follows.

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { GlassFrame } from './GlassFrame'
import { LaneHeader, Label, PLAIN, INSET } from './LaneHeader'

const DEMO_AGENT = '0x9c646C48a302f4725450669f1218d3FDb3e933AD'

type Quote = { amountUsd: number; network: string; payTo: string; description: string }
type Step = 'idle' | 'quoting' | 'quoted' | 'paying' | 'done' | 'error'

const CALLS = [
  { api: 'Market data · NVDA/USDG depth', kind: 'data', price: 0.01, ms: 182, when: '12s ago' },
  { api: 'Mintware score · 0x41c…9e2', kind: 'score', price: 0.01, ms: 96, when: '40s ago' },
  { api: 'Compute · 2 GPU-seconds', kind: 'compute', price: 0.04, ms: 1240, when: '2m ago' },
  { api: 'Mintware score · 0xa07…31b', kind: 'score', price: 0.01, ms: 88, when: '3m ago' },
  { api: 'News feed · tokenized equities', kind: 'data', price: 0.02, ms: 210, when: '6m ago' },
] as const

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

// Local Mineral line icons (24px grid, 1.7 stroke, currentColor) for the call kinds and the wallet.
function Glyph({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}
const KIND_ICON: Record<(typeof CALLS)[number]['kind'], ReactNode> = {
  data: <Glyph><rect x="3" y="4" width="18" height="14" rx="3.5" /><path d="m6.5 14 3.2-3.4 2.6 2.2 4.8-5" /></Glyph>,
  score: <Glyph><ellipse cx="12" cy="8" rx="8.5" ry="3.4" /><path d="M3.5 8v6c0 1.9 3.8 3.4 8.5 3.4s8.5-1.5 8.5-3.4V8" /><path d="m9.2 8.1 1.9 1.3 3.8-2.6" /></Glyph>,
  compute: <Glyph><rect x="5" y="5" width="14" height="14" rx="3" /><rect x="9" y="9" width="6" height="6" rx="1.2" /><path d="M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5" /></Glyph>,
}
const WalletIcon = <Glyph size={22}><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 9.5h18" /><ellipse cx="16.5" cy="14.2" rx="2" ry="1.1" /></Glyph>
const IdIcon = <Glyph size={22}><circle cx="8.5" cy="8" r="3" /><path d="M3 19c.6-3 2.8-4.8 5.5-4.8S13.4 16 14 19" /><circle cx="16.5" cy="9" r="2.5" /><path d="M15.4 14.4c.4-.1.7-.2 1.1-.2 2.3 0 4.2 1.6 4.5 4.3" /></Glyph>

function Tile({ children }: { children: ReactNode }) {
  return <span className="flex-none w-11 h-11 rounded-[12px] grid place-items-center" style={{ color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}>{children}</span>
}

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

  const asked = step !== 'idle' && step !== 'quoting' && step !== 'error'
  const priced = step === 'quoted' || step === 'paying' || step === 'done'

  return (
    <div>
      <LaneHeader
        eyebrow="Agents"
        title="Money built"
        accent="for agents."
        lede="Agents pay for data, compute and APIs one request at a time in USDC, and get paid the same way. Try the handshake against Mintware’s own paid endpoint."
        actions={<>
          <Link href="/agents/leaderboard" className="mw-btn-quiet">Agent leaderboard</Link>
          <Link href="/docs" className="mw-btn">Start building</Link>
        </>}
      />

      <div className="grid gap-5 mt-8 grid-cols-1 min-[960px]:grid-cols-[1.15fr_1fr]">
        {/* The paid-call console */}
        <div className="rounded-[24px] p-6 mw-raise-lg">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold">Make a paid call</span>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-[#E3F4EA] text-[#0F7A43]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" />Live quote
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2.5 font-mono text-[13px] rounded-[14px] px-3.5 py-3 overflow-x-auto whitespace-nowrap" style={INSET}>
            <span className="text-[11.5px] font-semibold px-1.5 py-0.5 rounded-md shrink-0" style={{ background: 'var(--mw-band)', color: 'var(--mw-peri-deep)' }}>GET</span>
            /api/x402/score?address={short(DEMO_AGENT)}
          </div>

          <ol className="mt-5 p-0 list-none flex flex-col">
            <Row n={1} last={false} state={asked ? 'done' : step === 'quoting' ? 'active' : 'idle'} title="Ask for the resource" body="The API answers 402 Payment Required with its price." />
            <Row
              n={2}
              last={false}
              state={priced ? 'done' : 'idle'}
              title={quote ? `Price: $${quote.amountUsd.toFixed(2)} USDC on ${quote.network}` : 'Read the price'}
              body={quote ? `${quote.description} · paid to ${short(quote.payTo)}` : 'Read live from Mintware’s production endpoint.'}
              live={priced}
            />
            <Row n={3} last state={step === 'done' ? 'done' : step === 'paying' ? 'active' : 'idle'} title="Pay and receive" body={step === 'done' ? 'Paid in one signed USDC transfer. Result delivered.' : 'The agent signs one USDC authorization; no account, no API key.'} simulated />
          </ol>

          <div className="mt-5">
            {step === 'idle' || step === 'error' ? (
              <button onClick={getQuote} className="mw-btn w-full !min-h-[50px]">Get a live quote</button>
            ) : step === 'quoting' ? (
              <button disabled className="mw-btn w-full !min-h-[50px] opacity-60 cursor-default">Asking the API…</button>
            ) : step === 'quoted' ? (
              <button onClick={pay} className="mw-btn w-full !min-h-[50px]">Pay ${quote?.amountUsd.toFixed(2)} and call</button>
            ) : step === 'paying' ? (
              <button disabled className="mw-btn w-full !min-h-[50px] opacity-60 cursor-default">Settling…</button>
            ) : (
              <button onClick={() => { setStep('idle'); setQuote(null) }} className="mw-btn-quiet w-full !min-h-[50px]">Run it again</button>
            )}
            {step === 'error' && <p className="text-[13px] mt-2" style={{ color: '#B42318' }}>Couldn’t reach the endpoint. Try again.</p>}
          </div>
        </div>

        {/* Wallet, stats, identity */}
        <div className="flex flex-col gap-4">
          <div className="rounded-[20px] p-6 flex gap-4 items-start" style={PLAIN}>
            <Tile>{WalletIcon}</Tile>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between"><Label>Agent wallet</Label><SimTag /></div>
              <div className="font-mono text-[32px] mt-1 tracking-[-0.03em]">$1,240.18</div>
              <div className="text-[13px] mt-1" style={{ color: '#62626F' }}>USDC in the agent’s own wallet, spent per call</div>
            </div>
          </div>
          <div className="rounded-[20px] p-5 grid grid-cols-2 gap-3" style={PLAIN}>
            <div className="rounded-[14px] p-4" style={INSET}><Label>Calls today</Label><div className="font-mono text-[24px] mt-1">3,412</div></div>
            <div className="rounded-[14px] p-4" style={INSET}><Label>Spent today</Label><div className="font-mono text-[24px] mt-1">$34.12</div></div>
          </div>
          <div className="rounded-[20px] p-5 flex gap-4 items-start" style={PLAIN}>
            <Tile>{IdIcon}</Tile>
            <div>
              <div className="flex items-center gap-2"><Label>Identity</Label><span className="font-mono text-[13px]">#37297</span></div>
              <p className="text-[14px] mt-1.5 mb-0 leading-[1.55]" style={{ color: '#454552' }}>
                Mintware is registered agent <b>#37297</b> on Base under ERC-8004. Any agent can carry an on-chain identity others can look up.
              </p>
              <Link href="/agents/leaderboard" className="inline-block mt-2 text-[13.5px] font-semibold no-underline hover:underline" style={{ color: '#4643D1' }}>See the leaderboard →</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 flex items-center gap-3"><Label>Recent calls</Label><SimTag /></div>
      <GlassFrame className="mt-3">
        <ul className="m-0 p-0 list-none">
          {CALLS.map((c, i) => (
            <li key={i} className="flex items-center gap-4 px-5 py-3.5 text-[14px]" style={i ? { borderTop: '1px solid var(--mw-line)' } : undefined}>
              <span className="flex-none w-10 h-10 rounded-full grid place-items-center" style={{ background: 'var(--mw-well)', color: '#4643D1', boxShadow: 'var(--mw-inset)' }}>{KIND_ICON[c.kind]}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold truncate">{c.api}</span>
                <span className="block text-[12.5px] mt-0.5" style={{ color: '#62626F' }}>{c.when} · <span className="font-mono">{c.ms} ms</span></span>
              </span>
              <span className="font-mono">−${c.price.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </GlassFrame>
    </div>
  )
}

function SimTag() {
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: '#454552', background: 'var(--mw-band)' }}>Simulated</span>
}

/** One step of the handshake. State is carried by the material: solid = done, dotted = in progress, inset = ahead. */
function Row({ n, state, title, body, simulated, live, last }: { n: number; state: 'idle' | 'active' | 'done'; title: string; body: string; simulated?: boolean; live?: boolean; last: boolean }) {
  return (
    <li className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <span
          className={`w-8 h-8 rounded-full grid place-items-center text-[12px] font-bold shrink-0 transition-colors ${state === 'active' ? 'mw-tex-dots' : ''}`}
          style={state === 'done' ? { backgroundColor: '#0F7A43', color: '#fff' } : state === 'active' ? { backgroundColor: '#E1DBFA', color: '#2E1F7A', boxShadow: '0 0 0 2px rgba(91,91,230,.4)' } : { backgroundColor: '#F2F2F5', color: '#454552', boxShadow: 'var(--mw-inset)' }}
        >
          {state === 'done' ? '✓' : n}
        </span>
        {!last && <span className="w-px flex-1 min-h-[14px] my-1" style={{ background: 'var(--mw-line)' }} />}
      </div>
      <div className={`pt-1 ${last ? '' : 'pb-4'} min-w-0`}>
        <div className="text-[14.5px] font-semibold">
          {title}
          {simulated && <span className="ml-2 align-middle"><SimTag /></span>}
          {live && <span className="ml-2 align-middle text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#E3F4EA] text-[#0F7A43]">From the live endpoint</span>}
        </div>
        <div className="text-[13px] mt-0.5 break-words" style={{ color: '#62626F' }}>{body}</div>
      </div>
    </li>
  )
}

'use client'

// Team · Policy & Approvals — design-forward, from the multisig/quorum patterns
// (Safe / Squads / Fireblocks / Utila): m-of-n as a headline stat, a pending queue
// with "1 of 2 signed" per row + an outcome prediction, history, and spending
// limits BELOW the quorum ("petty cash"). ALL illustrative — governance stack is
// in development, nothing here is live.

import { useState } from 'react'

const SIGNERS = ['Devon R.', 'Priya S.', 'Marco L.']
const QUORUM = 2

type Item = { title: string; detail: string; signed: number; need: number; by: string; when: string }
const PENDING: Item[] = [
  { title: 'Rebalance · ULV → Aave buffer', detail: 'Move $500,000 USDC to the idle buffer', signed: 1, need: 2, by: 'Devon R.', when: '2h ago' },
  { title: 'Withdraw to ops wallet',        detail: '$120,000 USDC → 0xA1c4…9F3b',           signed: 0, need: 2, by: 'Priya S.', when: '5h ago' },
  { title: 'Add signer',                    detail: 'Governance: add 0x9c64…33AD as Signer',  signed: 1, need: 2, by: 'Marco L.', when: '1d ago' },
]
const HISTORY: (Item & { status: string })[] = [
  { title: 'Fund card program', detail: '$250,000 USDC', signed: 2, need: 2, by: 'Devon R.', when: 'Aug 12', status: 'Executed' },
  { title: 'Rotate oracle signer', detail: 'Governance action', signed: 3, need: 3, by: 'Priya S.', when: 'Aug 8', status: 'Executed' },
]

const LIMITS = [
  { who: 'Priya S.', token: 'USDC', cap: '$50k', period: 'monthly', dest: 'whitelisted vendors' },
  { who: 'Marco L.', token: 'USDC', cap: '$10k', period: 'weekly',  dest: 'travel merchants' },
  { who: 'Ops',      token: 'USDC', cap: '$8k',  period: 'monthly', dest: 'SaaS vendors' },
]

const RULES = [
  'Treasury moves over $250k → 2-of-3 quorum',
  'A new destination address → quorum + address-book entry',
  'Card spend within a member’s limit → auto-approved by edge-auth',
  'Adding a signer or changing the threshold → itself goes through the queue',
]

function Progress({ signed, need }: { signed: number; need: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {Array.from({ length: need }).map((_, i) => (
        <span key={i} className={`w-[7px] h-[7px] rounded-full ${i < signed ? 'bg-peri' : 'border'}`} style={i < signed ? undefined : { background: 'var(--color-ground-cool)', borderColor: 'var(--color-hair)' }} />
      ))}
      <span className="text-[11px] text-ink-soft ml-1">{signed} of {need} signed</span>
    </span>
  )
}

export default function TeamPolicy() {
  const [view, setView] = useState<'pending' | 'history'>('pending')

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-atx-display font-medium text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">Policy & Approvals</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"><span className="w-[6px] h-[6px] rounded-full bg-peri" />Preview · illustrative</span>
      </div>
      <p className="text-ink-mid text-[14px] leading-[1.55] max-w-[64ch] mt-2.5">Larger treasury moves collect signatures before they execute; everyday spend flows under a per-member limit. Adding a signer or changing the threshold is itself a signed action.</p>

      {/* Quorum + limits headline */}
      <div className="grid grid-cols-[1fr_1.4fr] max-[720px]:grid-cols-1 gap-3 mt-5">
        <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5">
          <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Approval threshold</div>
          <div className="font-atx-display font-medium text-[32px] tracking-tight text-ink mt-1.5 tabular-nums">{QUORUM} <span className="text-ink-soft text-[20px]">of {SIGNERS.length}</span></div>
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {SIGNERS.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 text-[11px] text-ink-mid rounded-full bg-ground-cool px-2 py-1">
                <span className="w-[16px] h-[16px] rounded-full grid place-items-center text-[8px] font-semibold text-white" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))' }}>{s.split(' ').map((x) => x[0]).join('')}</span>
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5">
          <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft mb-2.5">Spending limits · below the quorum</div>
          <div className="flex flex-col gap-2">
            {LIMITS.map((l) => (
              <div key={l.who} className="flex items-center gap-2.5 text-[12.5px]">
                <span className="font-medium text-ink w-[70px] shrink-0 truncate">{l.who}</span>
                <span className="tabular-nums text-ink font-semibold">{l.cap}</span>
                <span className="text-ink-soft">/ {l.period}</span>
                <span className="text-ink-soft truncate max-[520px]:hidden">· {l.dest}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Queue */}
      <div className="flex items-center gap-2 mt-8 mb-3">
        <div className="inline-flex rounded-full bg-ground-cool p-0.5 text-[12px] font-semibold">
          {(['pending', 'history'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3.5 py-1.5 rounded-full capitalize transition-colors ${view === v ? 'bg-white text-ink shadow-card' : 'text-ink-soft'}`}>
              {v}{v === 'pending' ? ` · ${PENDING.length}` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-hidden">
        {(view === 'pending' ? PENDING : HISTORY).map((item, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-hair-soft last:border-0 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="font-atx-display font-semibold text-[14.5px] text-ink truncate">{item.title}</div>
              <div className="text-[12px] text-ink-mid mt-0.5 truncate">{item.detail}</div>
              <div className="text-[10.5px] text-ink-soft mt-1">Initiated by {item.by} · {item.when}</div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <Progress signed={item.signed} need={item.need} />
              {view === 'pending'
                ? <button disabled title="Coming soon" className="glass-pill glass-pill-sm">Sign →</button>
                : <span className="text-[11px] uppercase tracking-[0.06em] font-semibold text-mw-green bg-mw-green-muted rounded-full px-2.5 py-1">{(item as Item & { status: string }).status}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Rules */}
      <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">Policy rules</div>
      <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5 max-w-[720px]">
        <ul className="flex flex-col gap-2.5">
          {RULES.map((r) => (
            <li key={r} className="flex gap-2.5 items-start text-[13.5px] leading-[1.5] text-ink-mid">
              <span className="w-[7px] h-[7px] mt-1.5 rounded-full bg-peri inline-block shrink-0" />{r}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] text-ink-soft mt-5">Illustrative. The approvals and policy engine is in development — nothing here is live or an offer.</p>
    </>
  )
}

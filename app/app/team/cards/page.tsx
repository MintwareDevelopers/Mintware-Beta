'use client'

// Team · Cards & Spend — design-forward surface built on the researched patterns
// (Brex / Ramp / Mercury / Rain): a card directory (issue virtual/physical/vendor),
// a KPI strip, and a spend feed with status sub-tabs + receipt state. Cards spend
// against treasury NAV as a CREDIT line (à la Rain) — controls are pre-authorization
// guardrails, decided by the sub-150ms edge-auth engine. ALL figures ILLUSTRATIVE —
// corporate cards + settlement are in development, nothing here is live.

import { useState } from 'react'
import Link from 'next/link'

const KPIS = [
  { k: 'This cycle', v: '$61.8k', s: 'of $98k limit' },
  { k: 'Available credit', v: '$2.41M', s: 'against NAV' },
  { k: 'Active cards', v: '4', s: '1 frozen' },
  { k: 'Needs review', v: '2', s: 'awaiting action' },
]

type Card = { name: string; holder: string; last4: string; type: 'Virtual' | 'Physical' | 'Vendor'; limit: number; spent: number; frozen?: boolean }
const CARDS: Card[] = [
  { name: 'AWS · Infra',            holder: 'Devon R.', last4: '4821', type: 'Virtual',  limit: 25000, spent: 18420 },
  { name: 'Meta Ads',              holder: 'Priya S.', last4: '0912', type: 'Virtual',  limit: 40000, spent: 31200 },
  { name: 'Travel · Team',         holder: 'Marco L.', last4: '7734', type: 'Physical', limit: 15000, spent: 4230 },
  { name: 'SaaS · Subscriptions',  holder: 'Ops',      last4: '5567', type: 'Vendor',   limit: 8000,  spent: 7960 },
  { name: 'Contractor · Q3',       holder: 'Jenny K.', last4: '2201', type: 'Virtual',  limit: 10000, spent: 0, frozen: true },
]

type Status = 'approved' | 'needs_review' | 'flagged' | 'declined'
type Txn = { merchant: string; card: string; who: string; amt: number; date: string; status: Status; receipt: boolean }
const TXNS: Txn[] = [
  { merchant: 'Amazon Web Services', card: 'AWS · Infra',           who: 'Devon R.', amt: 4182.00,  date: 'Aug 14 · 118ms', status: 'approved',     receipt: true },
  { merchant: 'Meta Platforms',      card: 'Meta Ads',              who: 'Priya S.', amt: 12500.00, date: 'Aug 14 · 104ms', status: 'approved',     receipt: true },
  { merchant: 'Delta Air Lines',     card: 'Travel · Team',         who: 'Marco L.', amt: 2340.55,  date: 'Aug 13 · 131ms', status: 'needs_review', receipt: false },
  { merchant: 'Figma',               card: 'SaaS · Subscriptions',  who: 'Ops',      amt: 960.00,   date: 'Aug 13',         status: 'flagged',      receipt: true },
  { merchant: 'Uber',                card: 'Travel · Team',         who: 'Marco L.', amt: 84.20,    date: 'Aug 12',         status: 'approved',     receipt: false },
  { merchant: 'Blocked merchant',    card: 'Contractor · Q3',       who: 'Jenny K.', amt: 500.00,   date: 'Aug 12',         status: 'declined',     receipt: false },
]

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  approved:     { label: 'Approved',     cls: 'text-mw-green bg-mw-green-muted' },
  needs_review: { label: 'Needs review', cls: 'text-mw-amber bg-[rgba(194,122,0,0.08)]' },
  flagged:      { label: 'Flagged',      cls: 'text-[#D14343] bg-[rgba(209,67,67,0.08)]' },
  declined:     { label: 'Declined',     cls: 'text-ink-soft bg-ground-cool' },
}

const TABS = ['All', 'Needs review', 'Flagged', 'Approved', 'Declined'] as const
const TAB_FILTER: Record<(typeof TABS)[number], Status | null> = {
  All: null, 'Needs review': 'needs_review', Flagged: 'flagged', Approved: 'approved', Declined: 'declined',
}
const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const fmtK = (n: number) => `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`

export default function TeamCards() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('All')
  const filter = TAB_FILTER[tab]
  const rows = filter ? TXNS.filter((t) => t.status === filter) : TXNS

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-atx-display font-semibold text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">Cards & <span className="text-gradient-accent">Spend</span></h1>
          <span className="live-chip"><span className="dot" aria-hidden />Preview · illustrative</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="glass-pill glass-pill-sm" disabled title="Card issuance needs the CPN card issuer — coming soon">+ Issue card</button>
          <Link href="/app/org" className="glass-pill glass-pill-sm glass-pill-primary no-underline">Open treasury →</Link>
        </div>
      </div>
      <p className="text-ink-mid text-[14px] leading-[1.55] max-w-[64ch] mt-2.5">Cards spend against treasury liquidity as a credit line — capital keeps earning until settlement. Every authorization is decided by the sub-150ms edge-auth engine and enforced by pre-set limits and merchant controls.</p>

      {/* KPI strip */}
      <div className="grid grid-cols-4 max-[880px]:grid-cols-2 max-[480px]:grid-cols-1 gap-3 mt-5">
        {KPIS.map((k) => (
          <div key={k.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-4">
            <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{k.k}</div>
            <div className="font-atx-display font-medium text-[22px] tracking-tight text-ink mt-1.5 tabular-nums">{k.v}</div>
            <div className="text-[11px] text-ink-soft mt-0.5">{k.s}</div>
          </div>
        ))}
      </div>

      {/* Card directory */}
      <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">Cards · {CARDS.length}</div>
      <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3">
        {CARDS.map((c) => {
          const pct = Math.min(100, Math.round((c.spent / c.limit) * 100))
          const near = pct >= 95
          return (
            <div key={c.name} className={`rounded-[var(--radius-card)] border bg-white shadow-card p-5 ${c.frozen ? 'border-hair opacity-70' : 'border-hair'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-atx-display font-semibold text-[15px] text-ink truncate">{c.name}</div>
                  <div className="text-[11px] text-ink-soft mt-0.5">{c.holder} · <span className="font-mono">•••• {c.last4}</span></div>
                </div>
                <span className={`text-[9px] uppercase tracking-[0.08em] font-semibold rounded-full px-2 py-1 shrink-0 ${c.frozen ? 'bg-ground-cool text-ink-soft' : 'bg-lav text-peri-deep'}`} style={c.frozen ? undefined : { background: 'var(--color-pas-lav)', color: 'var(--color-peri-deep)' }}>{c.frozen ? 'Frozen' : c.type}</span>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="text-ink-soft">Spent this cycle</span>
                  <span className="text-ink tabular-nums font-medium">{fmtK(c.spent)} <span className="text-ink-soft">/ {fmtK(c.limit)}</span></span>
                </div>
                <div className="h-[6px] rounded-full bg-ground-cool overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: near ? '#D14343' : 'var(--color-peri)' }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Spend feed */}
      <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">Spend feed</div>
      <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-hidden">
        <div className="flex gap-1 px-3 pt-3 border-b border-hair-soft overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`shrink-0 rounded-t-lg px-3 py-2 text-[12.5px] font-medium whitespace-nowrap transition-colors ${tab === t ? 'text-ink border-b-2 border-peri -mb-px' : 'text-ink-soft hover:text-ink border-b-2 border-transparent -mb-px'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] max-[720px]:min-w-0 border-collapse text-[13px]">
            <thead>
              <tr className="bg-ground-cool border-b border-hair-soft">
                {['Merchant', 'Card · Holder', 'Amount', 'Date', 'Status'].map((h, i) => (
                  <th key={h} className={`text-[9.5px] uppercase tracking-[0.09em] font-semibold text-ink-soft px-4 py-2.5 ${i === 2 ? 'text-right' : 'text-left'} ${i === 1 ? 'max-[560px]:hidden' : ''} ${i === 3 ? 'max-[720px]:hidden' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const st = STATUS_META[t.status]
                return (
                  <tr key={i} className="border-b border-hair-soft last:border-0 hover:bg-ground-cool transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-ink truncate">{t.merchant}</span>
                        {t.receipt
                          ? <span title="Receipt attached" className="text-[9px] text-mw-green shrink-0">◉</span>
                          : <span title="Missing receipt" className="text-[9px] text-mw-amber shrink-0">○</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-mid max-[560px]:hidden"><span className="text-ink">{t.card}</span> · {t.who}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{fmt(t.amt)}</td>
                    <td className="px-4 py-3 text-ink-soft max-[720px]:hidden font-mono text-[11px]">{t.date}</td>
                    <td className="px-4 py-3"><span className={`inline-flex text-[10px] uppercase tracking-[0.06em] font-semibold rounded-full px-2 py-1 ${st.cls}`}>{st.label}</span></td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px] text-ink-soft">Nothing here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-ink-soft mt-5">Illustrative data. Corporate cards and on-chain settlement are in development on Base Sepolia — nothing here is live or an offer.</p>
    </>
  )
}

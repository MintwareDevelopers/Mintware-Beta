'use client'

// Team · Cards & Spend — ILLUSTRATIVE preview of the card surface (Brex / Ramp / Mercury patterns): a card
// directory, a KPI strip, and a spend feed with status tabs + receipt state. Model shown is the selected V1
// one: each card spends from its own PREFUNDED balance, refilled from the treasury within limits (Bridge +
// Stripe issuing, pre-enable). Not a credit line against NAV. All figures are examples; nothing here is live.

import { useState } from 'react'
import Link from 'next/link'
import { useRedirectToActiveOrg } from '@/components/web2/useActiveOrg'
import { PageHead, KpiRow, SLabel, StatusChip, Note, IconCard } from '@/components/web2/TeamKit'

const KPIS = [
  { k: 'This cycle', v: '$61.8k', s: 'of $98k limit' },
  { k: 'Card balances', v: '$12.4k', s: 'prefunded, ready to spend' },
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
  { merchant: 'Amazon Web Services', card: 'AWS · Infra',           who: 'Devon R.', amt: 4182.00,  date: 'Aug 14', status: 'approved',     receipt: true },
  { merchant: 'Meta Platforms',      card: 'Meta Ads',              who: 'Priya S.', amt: 12500.00, date: 'Aug 14', status: 'approved',     receipt: true },
  { merchant: 'Delta Air Lines',     card: 'Travel · Team',         who: 'Marco L.', amt: 2340.55,  date: 'Aug 13', status: 'needs_review', receipt: false },
  { merchant: 'Figma',               card: 'SaaS · Subscriptions',  who: 'Ops',      amt: 960.00,   date: 'Aug 13',         status: 'flagged',      receipt: true },
  { merchant: 'Uber',                card: 'Travel · Team',         who: 'Marco L.', amt: 84.20,    date: 'Aug 12',         status: 'approved',     receipt: false },
  { merchant: 'Blocked merchant',    card: 'Contractor · Q3',       who: 'Jenny K.', amt: 500.00,   date: 'Aug 12',         status: 'declined',     receipt: false },
]

// Approved = solid, needs review = dotted (still open), flagged/declined = warning/red.
const STATUS_META: Record<Status, { label: string; tone: 'live' | 'building' | 'warn' | 'muted' }> = {
  approved:     { label: 'Approved',     tone: 'live' },
  needs_review: { label: 'Needs review', tone: 'building' },
  flagged:      { label: 'Flagged',      tone: 'warn' },
  declined:     { label: 'Declined',     tone: 'muted' },
}

const TABS = ['All', 'Needs review', 'Flagged', 'Approved', 'Declined'] as const
const TAB_FILTER: Record<(typeof TABS)[number], Status | null> = {
  All: null, 'Needs review': 'needs_review', Flagged: 'flagged', Approved: 'approved', Declined: 'declined',
}
const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const fmtK = (n: number) => `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`

export default function TeamCards() {
  const redirecting = useRedirectToActiveOrg('/cards')
  const [tab, setTab] = useState<(typeof TABS)[number]>('All')
  const filter = TAB_FILTER[tab]
  const rows = filter ? TXNS.filter((t) => t.status === filter) : TXNS
  if (redirecting) return null

  return (
    <>
      <PageHead
        icon={<IconCard size={24} />}
        title="Cards & spend"
        status={{ tone: 'preview', label: 'Preview · illustrative' }}
        lede="Each card spends from its own prefunded balance, topped up from the treasury only by what was spent and within limits you set. Card issuance with Bridge + Stripe is not enabled yet."
        actions={<>
          <button className="mw-btn-quiet !min-h-[40px] disabled:opacity-60 disabled:cursor-not-allowed" disabled title="Card issuance is not enabled yet">+ Issue card</button>
          <Link href="/app/org" className="mw-btn !min-h-[40px]">Open treasury</Link>
        </>}
      />

      <KpiRow items={KPIS} />

      {/* Card directory */}
      <SLabel>Cards · {CARDS.length}</SLabel>
      <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3">
        {CARDS.map((c) => {
          const pct = Math.min(100, Math.round((c.spent / c.limit) * 100))
          const near = pct >= 95
          return (
            <div key={c.name} className={`rounded-[22px] p-5 ${c.frozen ? 'mw-inset mw-tex-hatch' : 'mw-raise'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-11 h-8 rounded-[8px] shrink-0" style={{ background: c.frozen ? '#D9D9E2' : c.type === 'Physical' ? '#4E4CD8' : 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.5)' }} aria-hidden />
                  <div className="min-w-0">
                    <div className="font-semibold text-[15.5px] text-ink truncate">{c.name}</div>
                    <div className="text-[12.5px] text-ink-soft mt-0.5">{c.holder} · <span className="font-geist-mono">•••• {c.last4}</span></div>
                  </div>
                </div>
                <StatusChip tone={c.frozen ? 'planned' : 'muted'}>{c.frozen ? 'Frozen' : c.type}</StatusChip>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                  <span className="text-ink-soft">Spent this cycle</span>
                  <span className="font-geist-mono text-ink">{fmtK(c.spent)} <span className="text-ink-soft">/ {fmtK(c.limit)}</span></span>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: near ? '#B42318' : '#7C7AF0' }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Spend feed */}
      <SLabel>Spend feed</SLabel>
      <div className="mw-raise rounded-[22px] overflow-hidden">
        <div className="p-3" style={{ borderBottom: '1px solid var(--mw-line)' }}>
          <div className="flex gap-0.5 p-1 rounded-[12px] overflow-x-auto w-fit max-w-full" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="shrink-0 rounded-[9px] px-3 py-1.5 text-[13px] font-medium whitespace-nowrap border-0 cursor-pointer" style={tab === t ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { background: 'transparent', color: 'var(--mw-ink-2)' }}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] max-[720px]:min-w-0 border-collapse text-[14px]">
            <thead>
              <tr style={{ background: 'var(--mw-ground)' }}>
                {['Merchant', 'Card · Holder', 'Amount', 'Date', 'Status'].map((h, i) => (
                  <th key={h} className={`text-[12px] font-semibold text-ink-soft px-4 py-3 ${i === 2 ? 'text-right' : 'text-left'} ${i === 1 ? 'max-[560px]:hidden' : ''} ${i === 3 ? 'max-[720px]:hidden' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const st = STATUS_META[t.status]
                return (
                  <tr key={i} className="border-t border-[rgba(21,21,29,.06)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-ink truncate">{t.merchant}</span>
                        {t.receipt
                          ? <span title="Receipt attached" className="text-[10px] shrink-0" style={{ color: 'var(--mw-gain)' }}>◉</span>
                          : <span title="Missing receipt" className="text-[10px] text-[#8A5300] shrink-0">○</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-mid max-[560px]:hidden"><span className="text-ink">{t.card}</span> · {t.who}</td>
                    <td className="px-4 py-3 text-right font-geist-mono text-ink">{fmt(t.amt)}</td>
                    <td className="px-4 py-3 text-ink-soft max-[720px]:hidden">{t.date}</td>
                    <td className="px-4 py-3"><StatusChip tone={st.tone}>{st.label}</StatusChip></td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-[14px] text-ink-soft">Nothing here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Note>Illustrative data. Corporate cards (Bridge + Stripe) are in development and not enabled. Nothing here is live or an offer.</Note>
    </>
  )
}

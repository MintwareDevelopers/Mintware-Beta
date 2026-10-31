'use client'

// Team · Policy & Approvals — design-forward, from the multisig/quorum patterns
// (Safe / Squads / Fireblocks / Utila): m-of-n as a headline stat, a pending queue
// with "1 of 2 signed" per row + an outcome prediction, history, and spending
// limits BELOW the quorum ("petty cash"). ALL illustrative — governance stack is
// in development, nothing here is live.

import { useState } from 'react'
import { useRedirectToActiveOrg } from '@/components/web2/useActiveOrg'
import { PageHead, SLabel, Panel, StatusChip, Note, IconShield } from '@/components/web2/TeamKit'

const SIGNERS = ['Devon R.', 'Priya S.', 'Marco L.']
const QUORUM = 2

type Item = { title: string; detail: string; signed: number; need: number; by: string; when: string }
const PENDING: Item[] = [
  { title: 'Rebalance · market → Treasury yield', detail: 'Move $500,000 USDC into Treasury yield', signed: 1, need: 2, by: 'Devon R.', when: '2h ago' },
  { title: 'Withdraw to ops wallet',        detail: '$120,000 USDC → 0xA1c4…9F3b',           signed: 0, need: 2, by: 'Priya S.', when: '5h ago' },
  { title: 'Add signer',                    detail: 'Governance: add 0x9c64…33AD as Signer',  signed: 1, need: 2, by: 'Marco L.', when: '1d ago' },
]
const HISTORY: (Item & { status: string })[] = [
  { title: 'Raise card balance limits', detail: 'Up to $25,000 prefunded across cards', signed: 2, need: 2, by: 'Devon R.', when: 'Aug 12', status: 'Executed' },
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
  'Card refills within a member’s limit → no approval needed',
  'Adding a signer or changing the threshold → itself goes through the queue',
]

// Signatures in the material: a collected signature is solid, one still awaited is dotted.
function Progress({ signed, need }: { signed: number; need: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {Array.from({ length: need }).map((_, k) => (
        <span key={k} className={`w-3 h-3 rounded-full ${k < signed ? '' : 'mw-tex-dots'}`} style={k < signed ? { background: '#7C7AF0' } : { backgroundColor: '#EDE9FB', boxShadow: 'inset 0 0 0 1px rgba(91,91,230,.25)' }} />
      ))}
      <span className="text-[12.5px] text-ink-mid ml-1">{signed} of {need} signed</span>
    </span>
  )
}

export default function TeamPolicy() {
  const redirecting = useRedirectToActiveOrg('/control')
  const [view, setView] = useState<'pending' | 'history'>('pending')
  if (redirecting) return null

  return (
    <>
      <PageHead
        icon={<IconShield size={24} />}
        title="Policy & approvals"
        status={{ tone: 'preview', label: 'Preview · illustrative' }}
        lede="Larger treasury moves collect signatures before they execute; everyday spend runs under each member's limit. Adding a signer or changing the threshold is itself a signed action."
      />

      {/* Threshold + limits */}
      <div className="grid grid-cols-[1fr_1.4fr] max-[720px]:grid-cols-1 gap-3 mt-7">
        <div className="mw-raise-lg rounded-[24px] p-6">
          <div className="text-[13px] text-ink-soft">Approval threshold</div>
          <div className="font-geist-mono text-[40px] tracking-[-0.04em] leading-none mt-2">{QUORUM} <span className="text-ink-soft text-[22px]">of {SIGNERS.length}</span></div>
          <div className="flex items-center gap-1.5 mt-4 flex-wrap">
            {SIGNERS.map((n) => (
              <span key={n} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-mid rounded-full pl-1 pr-2.5 py-1" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
                <span className="w-5 h-5 rounded-full" style={{ background: 'var(--mw-sheen)' }} aria-hidden />
                {n}
              </span>
            ))}
          </div>
        </div>
        <Panel title="Spending limits · below the threshold">
          <div className="flex flex-col gap-2.5">
            {LIMITS.map((l) => (
              <div key={l.who} className="flex items-center gap-3 text-[14px] rounded-[12px] px-3.5 py-2.5" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                <span className="font-semibold text-ink w-[76px] shrink-0 truncate">{l.who}</span>
                <span className="font-geist-mono text-ink">{l.cap}</span>
                <span className="text-ink-soft">/ {l.period}</span>
                <span className="text-ink-soft truncate max-[520px]:hidden">· {l.dest}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Queue */}
      <SLabel right={
        <div className="flex gap-0.5 p-1 rounded-[12px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} role="tablist">
          {(['pending', 'history'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className="px-3.5 py-1.5 rounded-[9px] text-[13px] font-semibold capitalize border-0 cursor-pointer" style={view === v ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { background: 'transparent', color: 'var(--mw-ink-2)' }}>
              {v}{v === 'pending' ? ` · ${PENDING.length}` : ''}
            </button>
          ))}
        </div>
      }>Approval queue</SLabel>

      <div className="mw-raise rounded-[22px] overflow-hidden">
        {(view === 'pending' ? PENDING : HISTORY).map((item, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-[rgba(21,21,29,.06)] last:border-0 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[15px] text-ink truncate">{item.title}</div>
              <div className="text-[13.5px] text-ink-mid mt-0.5 truncate">{item.detail}</div>
              <div className="text-[12.5px] text-ink-soft mt-1">Started by {item.by} · {item.when}</div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <Progress signed={item.signed} need={item.need} />
              {view === 'pending'
                ? <button disabled title="Signing from the terminal isn't built yet" className="mw-btn-quiet !min-h-[36px] text-[13px] opacity-60 cursor-not-allowed">Sign</button>
                : <StatusChip tone="live">{(item as Item & { status: string }).status}</StatusChip>}
            </div>
          </div>
        ))}
      </div>

      {/* Rules */}
      <SLabel>Policy rules</SLabel>
      <div className="mw-raise rounded-[22px] p-5 max-w-[760px]">
        <ul className="m-0 p-0 list-none flex flex-col gap-3">
          {RULES.map((r, k) => (
            <li key={r} className="flex gap-3 items-start text-[14.5px] leading-[1.5] text-ink-mid">
              <span className="font-geist-mono text-[12.5px] text-ink-soft mt-0.5 w-5 shrink-0">0{k + 1}</span>{r}
            </li>
          ))}
        </ul>
      </div>

      <Note>Illustrative. The approvals and policy engine is in development; nothing here is live or an offer.</Note>
    </>
  )
}

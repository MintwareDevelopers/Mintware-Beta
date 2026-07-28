'use client'

// =============================================================================
// RWA create flow — the augmented (vs DeFi) vault onboarding for the RWA surface.
// No on-chain deploy: persists a deal that enters Mintware review.
//
// Step 1 · Issuer      — pick a VERIFIED asset provider
// Step 2 · Instrument  — vRWA name, asset class, reserve/yield split, bands, KYC
// Step 3 · Deal        — description, yield-source + price/NAV explainers, terms
// Step 4 · Data room   — external links + documents (each reviewed)
// Step 5 · Review      — sign + submit → in_review
// =============================================================================

import { useAccount, useSignMessage } from 'wagmi'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { buildRwaDealMessage } from '@/lib/web3/signedActionMessages'

interface IssuerOption { id: string; name: string; status: string; address: string }
interface DealDoc { label: string; url: string; kind: string }
interface RwaDraft {
  issuerId: string
  name: string
  chainId: number
  underlyingAssetClass: string
  reservePct: number
  yieldPct: number
  priceBand: string
  settleDays: number
  kycTier: 'NONE' | 'BASIC' | 'ACCREDITED' | 'INSTITUTIONAL'
  description: string
  yieldSourceExplainer: string
  priceExplainer: string
  targetApyPct: number
  minInvestmentUsd: number
  documents: DealDoc[]
}

const ASSET_CLASSES = ['private-credit', 'real-estate', 'energy', 'treasuries', 'trade-finance', 'other']
const KYC_TIERS = ['NONE', 'BASIC', 'ACCREDITED', 'INSTITUTIONAL'] as const
const DOC_KINDS = [
  { v: 'term_sheet', l: 'Term sheet' },
  { v: 'legal_opinion', l: 'Legal opinion' },
  { v: 'spv_structure', l: 'SPV structure' },
  { v: 'audit', l: 'Audit' },
  { v: 'data_room', l: 'Data room' },
  { v: 'other', l: 'Other' },
]
const CHAINS = [{ id: 8453, label: 'Base' }, { id: 84532, label: 'Base Sepolia' }]
const STEPS = ['Issuer', 'Instrument', 'Deal', 'Data room', 'Review']

const INPUT = 'w-full px-3 py-2.5 border border-atx-ink/30 bg-atx-panel font-atx-mono text-[14px] text-atx-ink outline-none focus:border-atx-blue box-border'
const AREA = 'w-full px-3 py-2.5 border border-atx-ink/30 bg-atx-panel font-atx-display text-[13px] text-atx-ink outline-none focus:border-atx-blue box-border leading-[1.5] resize-y'
const LABEL = 'block mb-1.5 font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/55'
const HINT = 'block mt-1 text-[11px] text-atx-ink/45 font-atx-display'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`h-[7px] border border-atx-ink transition-all duration-200 ${i === current ? 'w-5 bg-atx-coral' : i < current ? 'w-[7px] bg-atx-mesquite' : 'w-[7px] bg-transparent'}`} />
      ))}
    </div>
  )
}

// ─── Step 1 · Issuer ──────────────────────────────────────────────────────────
function StepIssuer({ draft, patch }: { draft: RwaDraft; patch: (d: Partial<RwaDraft>) => void }) {
  const [issuers, setIssuers] = useState<IssuerOption[] | null>(null)
  useEffect(() => {
    fetch('/api/vaults/issuers?verified=1')
      .then(r => r.json())
      .then(d => setIssuers(Array.isArray(d.issuers) ? d.issuers : []))
      .catch(() => setIssuers([]))
  }, [])

  if (issuers === null) return <div className="text-[13px] text-atx-ink/55 font-atx-display">Loading issuers…</div>
  if (issuers.length === 0) return (
    <div className="border border-atx-ink/25 border-l-[3px] border-l-atx-clay bg-atx-panel px-4 py-3.5 flex items-start gap-2.5">
      <Star className="w-4 h-4 shrink-0 mt-0.5 text-atx-clay" />
      <div className="text-[12px] text-atx-ink/70 font-atx-display leading-[1.55]">
        No <strong>verified</strong> asset providers yet. RWA deals can only be published by a
        VERIFIED issuer (registered + diligence-checked in the SPV registry).
        <a href="/issuer/register" className="text-atx-blue font-semibold no-underline hover:underline"> Register as an asset provider →</a>
      </div>
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      <label className={LABEL}>Asset provider (issuer)</label>
      {issuers.map(iss => (
        <button
          key={iss.id}
          onClick={() => patch({ issuerId: iss.id })}
          className={`flex items-center justify-between px-4 py-3 text-left border ${draft.issuerId === iss.id ? 'border-atx-coral bg-atx-bone' : 'border-atx-ink/30 bg-atx-panel'}`}
        >
          <div className="flex items-center gap-2.5">
            <span className={`w-2 h-2 shrink-0 border border-atx-ink ${draft.issuerId === iss.id ? 'bg-atx-coral' : 'bg-transparent'}`} />
            <span className="text-[14px] font-bold font-atx-display text-atx-ink">{iss.name}</span>
          </div>
          <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-mesquite border border-atx-ink px-1.5 py-0.5">{iss.status}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Step 2 · Instrument ──────────────────────────────────────────────────────
function StepInstrument({ draft, patch }: { draft: RwaDraft; patch: (d: Partial<RwaDraft>) => void }) {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <label className={LABEL}>Deal / vault name</label>
        <input className={INPUT} placeholder="e.g. LiquidHectar Note II" value={draft.name} onChange={e => patch({ name: e.target.value })} />
        <span className={HINT}>Displayed to allocators on the deal page.</span>
      </div>
      <div>
        <label className={LABEL}>Underlying asset class</label>
        <div className="flex flex-wrap gap-2">
          {ASSET_CLASSES.map(a => (
            <button key={a} onClick={() => patch({ underlyingAssetClass: a })}
              className={`px-3 py-1.5 border font-atx-mono text-[12px] ${draft.underlyingAssetClass === a ? 'border-atx-coral bg-atx-bone text-atx-coral' : 'border-atx-ink/30 bg-atx-panel text-atx-ink/60'}`}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={LABEL}>Reserve %</label>
          <input type="number" className={INPUT} value={draft.reservePct || ''} onChange={e => { const r = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)); patch({ reservePct: r, yieldPct: 100 - r }) }} />
        </div>
        <div className="flex-1">
          <label className={LABEL}>Yield %</label>
          <input type="number" className={`${INPUT} opacity-70`} value={draft.yieldPct} readOnly />
          <span className={HINT}>Auto = 100 − reserve.</span>
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={LABEL}>Oracle price band</label>
          <input className={INPUT} placeholder="±15/±45" value={draft.priceBand} onChange={e => patch({ priceBand: e.target.value })} />
          <span className={HINT}>core / spec bands (%).</span>
        </div>
        <div className="flex-1">
          <label className={LABEL}>Settlement (days)</label>
          <input type="number" className={INPUT} value={draft.settleDays || ''} onChange={e => patch({ settleDays: parseInt(e.target.value) || 30 })} />
        </div>
      </div>
      <div>
        <label className={LABEL}>KYC tier required to redeem</label>
        <div className="flex gap-2">
          {KYC_TIERS.map(k => (
            <button key={k} onClick={() => patch({ kycTier: k })}
              className={`flex-1 px-2 py-2 border font-atx-mono text-[11px] uppercase tracking-[0.04em] ${draft.kycTier === k ? 'border-atx-coral bg-atx-bone text-atx-coral' : 'border-atx-ink/30 bg-atx-panel text-atx-ink/60'}`}>
              {k}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={LABEL}>Chain</label>
        <div className="flex gap-2">
          {CHAINS.map(c => (
            <button key={c.id} onClick={() => patch({ chainId: c.id })}
              className={`px-5 py-2 border font-atx-mono text-[13px] font-semibold ${draft.chainId === c.id ? 'border-atx-coral bg-atx-bone text-atx-coral' : 'border-atx-ink/30 bg-atx-panel text-atx-ink/60'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Step 3 · Deal ────────────────────────────────────────────────────────────
function StepDeal({ draft, patch }: { draft: RwaDraft; patch: (d: Partial<RwaDraft>) => void }) {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <label className={LABEL}>Deal overview</label>
        <textarea className={AREA} rows={4} placeholder="What is this deal? Who is the borrower / asset? What backs it?" value={draft.description} onChange={e => patch({ description: e.target.value })} />
      </div>
      <div>
        <label className={LABEL}>Where the yield comes from</label>
        <textarea className={AREA} rows={3} placeholder="e.g. senior secured private-credit interest at 12% coupon, monthly." value={draft.yieldSourceExplainer} onChange={e => patch({ yieldSourceExplainer: e.target.value })} />
      </div>
      <div>
        <label className={LABEL}>Price / NAV explanation</label>
        <textarea className={AREA} rows={3} placeholder="How the token is valued — NAV source, oracle cadence, what moves it." value={draft.priceExplainer} onChange={e => patch({ priceExplainer: e.target.value })} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={LABEL}>Target APY %</label>
          <input type="number" className={INPUT} placeholder="9" value={draft.targetApyPct || ''} onChange={e => patch({ targetApyPct: parseFloat(e.target.value) || 0 })} />
        </div>
        <div className="flex-1">
          <label className={LABEL}>Min investment (USD)</label>
          <input type="number" className={INPUT} placeholder="1000" value={draft.minInvestmentUsd || ''} onChange={e => patch({ minInvestmentUsd: parseFloat(e.target.value) || 0 })} />
        </div>
      </div>
    </div>
  )
}

// ─── Step 4 · Data room ───────────────────────────────────────────────────────
function StepDataRoom({ draft, patch }: { draft: RwaDraft; patch: (d: Partial<RwaDraft>) => void }) {
  function update(i: number, d: Partial<DealDoc>) {
    patch({ documents: draft.documents.map((doc, idx) => idx === i ? { ...doc, ...d } : doc) })
  }
  function add() { patch({ documents: [...draft.documents, { label: '', url: '', kind: 'other' }] }) }
  function remove(i: number) { patch({ documents: draft.documents.filter((_, idx) => idx !== i) }) }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] text-atx-ink/55 font-atx-display leading-[1.55]">
        Attach the deal documents allocators need — term sheet, legal opinion, SPV structure, audit,
        data-room link. Each is reviewed by Mintware before it goes public.
      </div>
      {draft.documents.map((doc, i) => (
        <div key={i} className="border border-atx-ink/25 bg-atx-panel p-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <input className={`${INPUT} flex-1`} placeholder="Label (e.g. Term sheet)" value={doc.label} onChange={e => update(i, { label: e.target.value })} />
            <select className={`${INPUT} w-[150px]`} value={doc.kind} onChange={e => update(i, { kind: e.target.value })}>
              {DOC_KINDS.map(k => <option key={k.v} value={k.v}>{k.l}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <input className={`${INPUT} flex-1 text-[12px]`} placeholder="https://…" value={doc.url} onChange={e => update(i, { url: e.target.value })} />
            <button onClick={() => remove(i)} className="px-3 border border-atx-ink/30 bg-atx-bone text-atx-clay font-atx-mono text-[12px]">Remove</button>
          </div>
        </div>
      ))}
      <button onClick={add} className="px-4 py-2.5 border border-dashed border-atx-ink/40 bg-transparent text-atx-ink/60 font-atx-mono text-[13px] hover:border-atx-ink hover:text-atx-ink">
        + Add document
      </button>
    </div>
  )
}

// ─── Step 5 · Review ──────────────────────────────────────────────────────────
function StepReview({ draft, submitting, error, onSubmit }: { draft: RwaDraft; submitting: boolean; error: string; onSubmit: () => void }) {
  const rows = [
    { label: 'Issuer', value: draft.issuerId || '—' },
    { label: 'Deal name', value: draft.name || '—' },
    { label: 'Asset class', value: draft.underlyingAssetClass || '—' },
    { label: 'Reserve / yield', value: `${draft.reservePct} / ${draft.yieldPct}%` },
    { label: 'Price band', value: draft.priceBand || '—' },
    { label: 'Settlement', value: `${draft.settleDays} days` },
    { label: 'KYC at redeem', value: draft.kycTier },
    { label: 'Target APY', value: draft.targetApyPct ? `${draft.targetApyPct}%` : '—' },
    { label: 'Min investment', value: draft.minInvestmentUsd ? `$${draft.minInvestmentUsd.toLocaleString()}` : '—' },
    { label: 'Documents', value: String(draft.documents.filter(d => d.label && d.url).length) },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-atx-panel border border-atx-ink overflow-hidden">
        {rows.map(({ label, value }, i) => (
          <div key={label} className={`flex justify-between items-center px-4 py-[11px] ${i < rows.length - 1 ? 'border-b border-atx-ink/20' : ''}`}>
            <span className="text-[12px] text-atx-ink/55 font-atx-display">{label}</span>
            <span className="text-[13px] font-semibold text-atx-ink font-atx-display">{value}</span>
          </div>
        ))}
      </div>
      <div className="bg-atx-panel border border-atx-ink/25 border-l-[3px] border-l-atx-mesquite px-3.5 py-2.5 text-[12px] text-atx-ink/70 font-atx-display leading-[1.55] flex items-start gap-2">
        <Star className="w-3.5 h-3.5 shrink-0 mt-0.5 text-atx-mesquite" />
        <span>Submitting sends this deal to <strong>Mintware review</strong>. It won&apos;t be public until approved. You&apos;ll sign a message to prove issuer ownership — no on-chain transaction or gas.</span>
      </div>
      {error && <div className="text-[12px] text-atx-clay bg-atx-panel border border-atx-clay/40 px-3.5 py-2.5 font-atx-display">{error}</div>}
      <button onClick={onSubmit} disabled={submitting}
        className="p-[13px] bg-atx-coral text-atx-ink border border-atx-ink font-atx-mono text-[15px] font-bold disabled:opacity-60 disabled:cursor-not-allowed">
        {submitting ? 'Submitting for review…' : 'Submit deal for review →'}
      </button>
    </div>
  )
}

// ─── main ─────────────────────────────────────────────────────────────────────
export function RwaCreateFlow({ onBack }: { onBack: () => void }) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ vaultId: string } | null>(null)

  const [draft, setDraft] = useState<RwaDraft>({
    issuerId: '', name: '', chainId: 8453,
    underlyingAssetClass: 'private-credit', reservePct: 40, yieldPct: 60,
    priceBand: '±15/±45', settleDays: 30, kycTier: 'BASIC',
    description: '', yieldSourceExplainer: '', priceExplainer: '',
    targetApyPct: 0, minInvestmentUsd: 0, documents: [],
  })
  const patch = (d: Partial<RwaDraft>) => setDraft(p => ({ ...p, ...d }))

  function canAdvance() {
    if (step === 0) return draft.issuerId.length > 0
    if (step === 1) return draft.name.trim().length > 0
    if (step === 2) return draft.description.trim().length > 0
    return true
  }

  async function handleSubmit() {
    if (!address) return
    setError(''); setSubmitting(true)
    try {
      const issuedAt = Date.now()
      const authMessage = buildRwaDealMessage({ issuerWallet: address, issuedAt, name: draft.name, issuerId: draft.issuerId, chainId: draft.chainId })
      const authSignature = await signMessageAsync({ message: authMessage })
      const res = await fetch('/api/vaults/rwa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name, issuer_wallet: address, issuer_id: draft.issuerId, chain_id: draft.chainId,
          description: draft.description, yield_source_explainer: draft.yieldSourceExplainer,
          price_explainer: draft.priceExplainer, underlying_asset_class: draft.underlyingAssetClass,
          target_apy_pct: draft.targetApyPct, min_investment_usd: draft.minInvestmentUsd,
          reserve_pct: draft.reservePct, yield_pct: draft.yieldPct, price_band: draft.priceBand,
          settle_days: draft.settleDays, kyc_tier_required: draft.kycTier,
          documents: draft.documents.filter(d => d.label && d.url),
          issuedAt, authMessage, authSignature,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`) }
      const { vault_id } = await res.json()
      setDone({ vaultId: vault_id })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink">
      <MwNav />
      <div className="max-w-[560px] mx-auto my-20 px-7 text-center [&_*]:rounded-none">
        <div className="flex justify-center mb-4"><Star className="w-12 h-12 text-atx-coral" /></div>
        <div className="text-[22px] font-extrabold font-atx-display mb-2">Deal submitted for review</div>
        <div className="text-[14px] text-atx-ink/55 font-atx-display mb-7 leading-[1.6]">
          <strong>{draft.name}</strong> is now in Mintware review. Once approved it publishes to the RWA surface with its full deal page.
        </div>
        <Link href="/vaults" className="px-5 py-2.5 bg-atx-blue text-white border border-atx-ink text-[14px] font-semibold font-atx-mono no-underline">View all vaults</Link>
      </div>
    </div>
  )

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink">
      <MwNav />
      <div className="max-w-[560px] mx-auto px-7 pt-7 pb-[60px] max-[640px]:px-4 max-[640px]:pt-5 [&_*]:rounded-none">
        <div className="mb-5 flex items-center gap-2">
          <button onClick={onBack} className="text-[13px] text-atx-ink/55 font-atx-display no-underline hover:text-atx-ink bg-transparent border-0 cursor-pointer p-0">← Change surface</button>
          <span className="text-atx-ink/30">/</span>
          <span className="text-[13px] text-atx-ink font-atx-display font-semibold">Create RWA deal</span>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-[22px] font-extrabold font-atx-display m-0">{STEPS[step]}</h1>
            <StepDots current={step} total={STEPS.length} />
          </div>
          <div className="text-[13px] text-atx-ink/55 font-atx-display">
            {step === 0 && 'Pick the verified asset provider issuing this deal.'}
            {step === 1 && 'Define the tokenized instrument and its risk parameters.'}
            {step === 2 && 'Explain the deal, where yield comes from, and how it\'s priced.'}
            {step === 3 && 'Attach the documents allocators need to diligence it.'}
            {step === 4 && 'Review, then submit for Mintware approval.'}
          </div>
        </div>

        <div className="bg-atx-panel border border-atx-ink p-7">
          {step === 0 && <StepIssuer draft={draft} patch={patch} />}
          {step === 1 && <StepInstrument draft={draft} patch={patch} />}
          {step === 2 && <StepDeal draft={draft} patch={patch} />}
          {step === 3 && <StepDataRoom draft={draft} patch={patch} />}
          {step === 4 && <StepReview draft={draft} submitting={submitting} error={error} onSubmit={handleSubmit} />}

          {step < 4 && (
            <div className="flex items-center justify-between mt-6">
              <button
                className="px-[22px] py-2.5 bg-transparent border border-atx-ink/30 text-atx-ink/60 font-atx-mono text-[14px] font-semibold hover:border-atx-ink"
                onClick={() => step > 0 ? setStep(s => s - 1) : onBack()}
              >
                Back
              </button>
              <button
                className="px-[22px] py-2.5 bg-atx-coral text-atx-ink border border-atx-ink font-atx-mono text-[14px] font-semibold disabled:opacity-45 disabled:cursor-not-allowed"
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
              >
                {step === 3 ? 'Review →' : 'Continue →'}
              </button>
            </div>
          )}
          {step === 4 && (
            <button className="mt-2.5 w-full px-[22px] py-2.5 bg-transparent border border-atx-ink/30 text-atx-ink/60 font-atx-mono text-[14px] font-semibold hover:border-atx-ink" onClick={() => setStep(3)}>
              ← Back to edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

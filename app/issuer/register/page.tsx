'use client'

// /issuer/register — self-serve RWA asset-provider registration.
// Creates a REGISTERED issuer that enters the Mintware review queue for VERIFY.

import { useAccount, useSignMessage } from 'wagmi'
import { useState } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { buildIssuerRegisterMessage } from '@/lib/web3/signedActionMessages'

const INPUT = 'w-full px-3 py-2.5 border border-atx-ink/30 bg-atx-panel font-atx-mono text-[14px] text-atx-ink outline-none focus:border-atx-blue box-border'
const LABEL = 'block mb-1.5 font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/55'
const HINT = 'block mt-1 text-[11px] text-atx-ink/45 font-atx-display'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

interface LinkRow { label: string; url: string }

function RegisterContent() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [name, setName] = useState('')
  const [since, setSince] = useState('')
  const [links, setLinks] = useState<LinkRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const id = slugify(name)
  const canSubmit = name.trim().length > 1 && id.length >= 2 && !submitting

  async function submit() {
    if (!address || !canSubmit) return
    setSubmitting(true); setError('')
    try {
      const issuedAt = Date.now()
      const authMessage = buildIssuerRegisterMessage({ wallet: address, issuedAt, id, name })
      const authSignature = await signMessageAsync({ message: authMessage })
      const res = await fetch('/api/vaults/issuers/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id, name, wallet: address, since: since || undefined,
          links: links.filter(l => l.label && l.url),
          issuedAt, authMessage, authSignature,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`) }
      setDone(id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Registration failed') }
    finally { setSubmitting(false) }
  }

  if (done) return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink">
      <MwNav />
      <div className="max-w-[520px] mx-auto my-20 px-7 text-center [&_*]:rounded-none">
        <div className="flex justify-center mb-4"><Star className="w-12 h-12 text-atx-coral" /></div>
        <div className="text-[22px] font-extrabold mb-2">Registration submitted</div>
        <div className="text-[14px] text-atx-ink/55 mb-7 leading-[1.6]">
          <strong>{name}</strong> is registered as <code className="font-atx-mono">{done}</code> and in Mintware review.
          Once verified you can publish RWA deals from the create flow.
        </div>
        <Link href="/vault/create" className="px-5 py-2.5 bg-atx-blue text-white border border-atx-ink text-[14px] font-semibold font-atx-mono no-underline">Go to create</Link>
      </div>
    </div>
  )

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink">
      <MwNav />
      <div className="max-w-[560px] mx-auto px-7 pt-7 pb-[60px] max-[640px]:px-4 [&_*]:rounded-none">
        <div className="mb-5 flex items-center gap-2">
          <Link href="/vault/create" className="text-[13px] text-atx-ink/55 no-underline hover:text-atx-ink">← Create</Link>
          <span className="text-atx-ink/30">/</span>
          <span className="text-[13px] text-atx-ink font-semibold">Register as issuer</span>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1.5">
            <Star className="w-4 h-4 text-atx-coral" />
            <span className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55">Asset provider onboarding</span>
          </div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">Register as an RWA issuer</h1>
          <p className="text-[13px] text-atx-ink/55 mt-2 leading-[1.55]">
            Register your asset-provider profile. Mintware reviews and verifies issuers before they can
            publish deals — this puts you in the queue.
          </p>
        </div>

        <div className="bg-atx-panel border border-atx-ink p-7 flex flex-col gap-[18px]">
          <div>
            <label className={LABEL}>Issuer name</label>
            <input className={INPUT} placeholder="e.g. LiquidHectar Capital" value={name} onChange={e => setName(e.target.value)} />
            <span className={HINT}>Public id: <code className="font-atx-mono text-atx-ink/60">{id || '—'}</code></span>
          </div>
          <div>
            <label className={LABEL}>Provider since (optional)</label>
            <input className={INPUT} placeholder="2026-02" value={since} onChange={e => setSince(e.target.value)} />
          </div>
          <div>
            <label className={LABEL}>Links (optional)</label>
            <div className="flex flex-col gap-2">
              {links.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <input className={`${INPUT} w-[130px]`} placeholder="Website" value={l.label} onChange={e => setLinks(links.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
                  <input className={`${INPUT} flex-1 text-[12px]`} placeholder="https://…" value={l.url} onChange={e => setLinks(links.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))} />
                  <button onClick={() => setLinks(links.filter((_, idx) => idx !== i))} className="px-3 border border-atx-ink/30 bg-atx-bone text-atx-clay font-atx-mono text-[12px]">×</button>
                </div>
              ))}
              <button onClick={() => setLinks([...links, { label: '', url: '' }])} className="px-4 py-2 border border-dashed border-atx-ink/40 text-atx-ink/60 font-atx-mono text-[12px] hover:border-atx-ink hover:text-atx-ink">+ Add link</button>
            </div>
          </div>

          {error && <div className="text-[12px] text-atx-clay bg-atx-bone border border-atx-clay/40 px-3.5 py-2.5 font-atx-display">{error}</div>}

          <div className="bg-atx-bone border border-atx-ink/25 border-l-[3px] border-l-atx-mesquite px-3.5 py-2.5 text-[12px] text-atx-ink/70 leading-[1.55] flex items-start gap-2">
            <Star className="w-3.5 h-3.5 shrink-0 mt-0.5 text-atx-mesquite" />
            <span>You&apos;ll sign a message to prove wallet ownership — no on-chain transaction or gas.</span>
          </div>

          <button onClick={submit} disabled={!canSubmit}
            className="p-[13px] bg-atx-coral text-atx-ink border border-atx-ink font-atx-mono text-[15px] font-bold disabled:opacity-45 disabled:cursor-not-allowed">
            {submitting ? 'Submitting…' : 'Register issuer →'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function IssuerRegisterPage() {
  return (
    <MwAuthGuard>
      <RegisterContent />
    </MwAuthGuard>
  )
}

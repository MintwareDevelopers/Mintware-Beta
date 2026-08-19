'use client'

// Create an org (the missing entry point). Name → auto-slug → POST /api/orgs (signed) → redirect to the
// new org home. Static /app/org/new wins over the dynamic /app/org/[slug], so no collision.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSignMessage } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)

export default function NewOrgPage() {
  const router = useRouter()
  const { address, isConnected } = useMintwareIdentity()
  const { signMessageAsync } = useSignMessage()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const autoSlug = useMemo(() => (slug ? slugify(slug) : slugify(name)), [name, slug])

  const create = async () => {
    if (!address || !name.trim()) return
    if (autoSlug.length < 3) return setErr('Slug must be at least 3 characters.')
    setBusy(true); setErr('')
    try {
      const res = await signedOrgFetch({ path: '/api/orgs', action: 'mintware-org-create', payload: { name: name.trim(), slug: autoSlug }, address, signMessageAsync })
      const d = await res.json()
      if (res.ok && d.org?.slug) router.push(`/app/org/${d.org.slug}`)
      else setErr(d.error ?? 'Could not create org.')
    } catch (e) { setErr((e as Error)?.message ?? String(e)) } finally { setBusy(false) }
  }

  return (
    <MwAuthGuard>
      <div className="min-h-screen font-atx-display bg-white text-ink">
        <MwNav />
        <main className="mx-auto max-w-[520px] px-6 max-[700px]:px-4 py-[56px]">
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">New treasury</div>
          <h1 className="font-atx-display font-semibold text-[28px] tracking-[-0.03em] mt-2">Create an org</h1>
          <p className="text-[13px] text-ink-mid mt-1.5 leading-[1.5]">Spin up a treasury tenant. You'll be the owner — invite your team, record your vault, and start spending from an earning balance.</p>

          <div className="soft-card p-5 mt-6 flex flex-col gap-4">
            <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Org name</span>
              <input value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug('') }} placeholder="Acme Labs" className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[15px] outline-none focus:border-peri" />
            </label>
            <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Public slug</span>
              <div className="mt-1.5 flex items-center rounded-[10px] border border-hair overflow-hidden focus-within:border-peri">
                <span className="pl-3 text-[13px] text-ink-soft font-mono select-none">/org/</span>
                <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder={autoSlug || 'acme-labs'} className="flex-1 px-1.5 py-2.5 text-[14px] font-mono outline-none" />
              </div>
              <span className="text-[11px] text-ink-soft mt-1 block">Your public treasury page will live at <span className="font-mono">/org/{autoSlug || 'your-slug'}</span></span>
            </label>
            <button onClick={create} disabled={busy || !isConnected || !name.trim() || autoSlug.length < 3} className="rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">
              {busy ? 'Creating…' : isConnected ? 'Create org' : 'Connect a wallet to create'}
            </button>
          </div>
          {err && <div className="mt-4 rounded-[var(--radius-card)] border border-[rgba(194,83,122,0.3)] bg-white p-3.5 text-[13px] text-ink">{err}</div>}
        </main>
      </div>
    </MwAuthGuard>
  )
}

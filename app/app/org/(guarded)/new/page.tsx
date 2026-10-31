'use client'

// Create an org (the missing entry point). Name → auto-slug → POST /api/orgs (signed) → redirect to the
// new org home. Static /app/org/new wins over the dynamic /app/org/[slug], so no collision. Chrome comes
// from the shared TeamTerminalShell layout — same shell as /app/team/*.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSignMessage } from 'wagmi'
import { PageHead, IconOrg } from '@/components/web2/TeamKit'
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
      <div className="max-w-[520px] mx-auto">
        <PageHead
          back={{ href: '/app/org', label: 'Your orgs' }}
          icon={<IconOrg size={24} />}
          title="Create an org"
          lede="Spin up a treasury for your team. You'll be the owner: invite members, set their roles, and record payments in one ledger."
        />

        <div className="mw-raise rounded-[24px] p-6 mt-7 flex flex-col gap-5">
          <label className="block"><span className="text-[13px] font-semibold text-ink-mid">Org name</span>
            <input value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug('') }} placeholder="Acme Labs" className="mt-1.5 w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[15px]" />
          </label>
          <label className="block"><span className="text-[13px] font-semibold text-ink-mid">Public slug</span>
            <div className="mt-1.5 flex items-center rounded-[12px] overflow-hidden bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] focus-within:outline-2 focus-within:outline-[#5B5BE6]">
              <span className="pl-3.5 text-[14px] text-ink-soft font-geist-mono select-none">/org/</span>
              <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder={autoSlug || 'acme-labs'} className="flex-1 bg-transparent px-1.5 min-h-[44px] text-[14px] font-geist-mono outline-none" />
            </div>
            <span className="text-[11px] text-ink-soft mt-1 block">Your public treasury page will live at <span className="font-mono">/org/{autoSlug || 'your-slug'}</span></span>
          </label>
          <button onClick={create} disabled={busy || !isConnected || !name.trim() || autoSlug.length < 3} className="mw-btn !min-h-[48px] disabled:opacity-50">
            {busy ? 'Creating…' : isConnected ? 'Create org' : 'Connect a wallet to create'}
          </button>
        </div>
        {err && <div className="mt-4 rounded-[16px] bg-[#FBE9E7] px-4 py-3 text-[14px] text-[#B42318]">{err}</div>}
      </div>
    </MwAuthGuard>
  )
}

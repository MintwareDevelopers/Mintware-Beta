'use client'

// Pay a vendor (#4) — one recipient, one amount, an optional category + memo for reporting. Validated
// against the caller's CUMULATIVE daily cap + the treasury's on-chain headroom, then RECORDED to the
// unified treasury spend ledger (treasury_spend_events). On-chain per-recipient settlement is the next
// milestone (see app/api/orgs/[id]/pay/route.ts header). NOT a netting engine — one payment.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { policyForRole } from '@/lib/org/rolePresets'

const CHAINS = [
  { id: 84532, name: 'Base Sepolia' },
]
const toAtomic = (usd: string) => {
  const n = Math.round(parseFloat(usd) * 1e6)
  return Number.isFinite(n) && n > 0 ? String(n) : null
}

export default function PayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address } = useMintwareIdentity()
  const { signMessageAsync } = useSignMessage()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [chainId, setChainId] = useState(84532)
  const [category, setCategory] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  // Permission to pay vendors — owner or a role with canPayVendors (manager). Resolved from the
  // caller's OWN membership on the ?address read (server also enforces this on /pay; this just hides
  // the form from contributors/vendors so it never looks actionable). 'loading' until we know.
  const [perm, setPerm] = useState<'loading' | 'allowed' | 'denied'>('loading')

  useEffect(() => {
    const q = address ? `?address=${address}` : ''
    fetch(`/api/orgs/${slug}/treasury${q}`).then((r) => r.json()).then((d) => {
      if (!d?.org) return
      setOrgId(d.org.id); setOrgName(d.org.name)
      if (!address) { setPerm('loading'); return } // wait for identity before deciding
      const isOwner = !!(d.org.ownerWallet && d.org.ownerWallet.toLowerCase() === address.toLowerCase())
      const canPay = isOwner || (d.member?.status === 'active' && policyForRole(d.member.role).canPayVendors)
      setPerm(canPay ? 'allowed' : 'denied')
    }).catch(() => {})
  }, [slug, address])

  const submit = async () => {
    if (!orgId || !address) return
    const atomic = toAtomic(amount)
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return setResult({ ok: false, text: 'Enter a valid recipient address.' })
    if (!atomic) return setResult({ ok: false, text: 'Enter a valid amount.' })
    setBusy(true); setResult(null)
    try {
      const res = await signedOrgFetch({
        path: `/api/orgs/${orgId}/pay`, action: 'mintware-org-pay',
        payload: { payments: [{ to, amountUsdc: atomic, chainId }], category: category || undefined, memo: memo || undefined }, address, signMessageAsync,
      })
      const d = await res.json()
      if (res.ok && d.ok) setResult({ ok: true, text: `Recorded ✓ — ${amount} USDC to ${to.slice(0, 6)}… It’s in your treasury ledger. On-chain settlement lands with the treasury settle path.` })
      else setResult({ ok: false, text: d.error || d.message || 'Payment failed.' })
    } catch (e) { setResult({ ok: false, text: String(e) }) } finally { setBusy(false) }
  }

  return (
    <MwAuthGuard>
      <div className="min-h-screen font-atx-display bg-white text-ink">
        <MwNav />
        <main className="mx-auto max-w-[560px] px-6 max-[700px]:px-4 py-[44px]">
          <Link href={`/app/org/${slug}`} className="text-[12.5px] text-peri-deep no-underline hover:underline">← {orgName || 'Org'}</Link>
          <h1 className="font-atx-display font-semibold text-[26px] tracking-[-0.03em] mt-3">Pay a vendor</h1>
          <p className="text-[13px] text-ink-mid mt-1.5">Straight from the treasury — no idle float. Authorized against your role cap and the treasury's live balance.</p>

          {perm === 'denied' ? (
            <div className="soft-card p-6 mt-6 text-[13.5px] text-ink-mid leading-[1.55]">
              Paying vendors from the treasury is limited to the <span className="font-semibold text-ink">owner</span> and <span className="font-semibold text-ink">managers</span>. Your role can still hold and spend on your own card. Ask an owner if you need to send payments.
            </div>
          ) : perm === 'loading' ? (
            <div className="soft-card p-6 mt-6 text-[13px] text-ink-soft">Checking your permissions…</div>
          ) : (
            <>
              <div className="soft-card p-5 mt-6 flex flex-col gap-4">
                <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Recipient</span>
                  <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] font-mono outline-none focus:border-peri" />
                </label>
                <div className="flex gap-3">
                  <label className="flex-1 block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Amount (USDC)</span>
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] tabular-nums outline-none focus:border-peri" />
                  </label>
                  <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Recipient chain</span>
                    <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))} className="mt-1.5 rounded-[10px] border border-hair px-3 py-2.5 text-[14px] bg-white outline-none focus:border-peri">
                      {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex gap-3 max-[520px]:flex-col">
                  <label className="flex-1 block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Category <span className="text-ink-soft/70 normal-case tracking-normal font-normal">· for reports</span></span>
                    <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Contractors" maxLength={80} className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] outline-none focus:border-peri" />
                  </label>
                  <label className="flex-1 block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Memo <span className="text-ink-soft/70 normal-case tracking-normal font-normal">· optional</span></span>
                    <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What's this for?" maxLength={280} className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] outline-none focus:border-peri" />
                  </label>
                </div>
                <button onClick={submit} disabled={busy} className="rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">{busy ? 'Recording…' : 'Pay from treasury'}</button>
              </div>

              {result && <div className={`mt-4 rounded-[var(--radius-card)] border p-4 text-[13px] leading-[1.5] ${result.ok ? 'border-[rgba(42,158,138,0.3)] bg-mw-green-muted text-ink' : 'border-[rgba(194,83,122,0.3)] bg-white text-ink'}`}>{result.text}</div>}

              <p className="text-[11.5px] text-ink-soft mt-6">Cross-chain payments route via Circle CCTP. Testnet-only, unaudited — no real value moves.</p>
            </>
          )}
        </main>
      </div>
    </MwAuthGuard>
  )
}

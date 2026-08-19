'use client'

// Pay a vendor (#4) — the atomic settlement. One recipient, one amount, a chain dropdown (CCTP routes
// cross-chain). Validated against your role cap + the treasury's on-chain headroom, then settled via the
// relayer (or shown as "ready — relayer deploy-gated on testnet"). NOT a netting engine — one payment.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'

const CHAINS = [
  { id: 84532, name: 'Base Sepolia' },
  { id: 5042002, name: 'Circle Arc' },
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
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch(`/api/orgs/${slug}/treasury`).then((r) => r.json()).then((d) => { if (d?.org) { setOrgId(d.org.id); setOrgName(d.org.name) } }).catch(() => {})
  }, [slug])

  const submit = async () => {
    if (!orgId || !address) return
    const atomic = toAtomic(amount)
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return setResult({ ok: false, text: 'Enter a valid recipient address.' })
    if (!atomic) return setResult({ ok: false, text: 'Enter a valid amount.' })
    setBusy(true); setResult(null)
    try {
      const res = await signedOrgFetch({
        path: `/api/orgs/${orgId}/pay`, action: 'mintware-org-pay',
        payload: { payments: [{ to, amountUsdc: atomic, chainId }] }, address, signMessageAsync,
      })
      const d = await res.json()
      if (res.ok && d.ok) setResult({ ok: true, text: `Paid ${amount} USDC to ${to.slice(0, 6)}… on ${CHAINS.find((c) => c.id === chainId)?.name}.` })
      else if (res.status === 503 && d.gated === 'relayer_not_configured') setResult({ ok: true, text: `Validated ✓ — ${amount} USDC ready to settle. Live settlement needs the relayer (deploy-gated on testnet).` })
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
            <button onClick={submit} disabled={busy} className="rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">{busy ? 'Authorizing…' : 'Pay from treasury'}</button>
          </div>

          {result && <div className={`mt-4 rounded-[var(--radius-card)] border p-4 text-[13px] leading-[1.5] ${result.ok ? 'border-[rgba(42,158,138,0.3)] bg-mw-green-muted text-ink' : 'border-[rgba(194,83,122,0.3)] bg-white text-ink'}`}>{result.text}</div>}

          <p className="text-[11.5px] text-ink-soft mt-6">Cross-chain payments route via Circle CCTP. Testnet-only, unaudited — no real value moves.</p>
        </main>
      </div>
    </MwAuthGuard>
  )
}

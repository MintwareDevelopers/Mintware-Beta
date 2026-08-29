'use client'

// Run payroll (#5) — paste or upload a {wallet, amount} CSV, preview the batch + total, settle as ONE
// batch payment from the treasury. NOT a scheduler or HR suite — CSV in, one batch out.

import { type ChangeEvent, use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { policyForRole } from '@/lib/org/rolePresets'

interface Row { to: string; amountUsdc: string; usd: number; ok: boolean }

function parseCsv(text: string): Row[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/^wallet|^address|^to\b/i.test(l))
    .map((line) => {
      const [addr, amt] = line.split(/[,\t]/).map((s) => s.trim())
      const usd = parseFloat(amt)
      const atomic = Math.round(usd * 1e6)
      const ok = /^0x[a-fA-F0-9]{40}$/.test(addr ?? '') && Number.isFinite(usd) && usd > 0
      return { to: addr ?? '', amountUsdc: ok ? String(atomic) : '0', usd: Number.isFinite(usd) ? usd : 0, ok }
    })
}

export default function PayrollPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address } = useMintwareIdentity()
  const { signMessageAsync } = useSignMessage()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [csv, setCsv] = useState('')
  const [category, setCategory] = useState('Payroll')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  // Payroll pays vendors — owner or a canPayVendors role only (server also enforces on /pay). 'loading' until known.
  const [perm, setPerm] = useState<'loading' | 'allowed' | 'denied'>('loading')

  useEffect(() => {
    const q = address ? `?address=${address}` : ''
    fetch(`/api/orgs/${slug}/treasury${q}`).then((r) => r.json()).then((d) => {
      if (!d?.org) return
      setOrgId(d.org.id); setOrgName(d.org.name)
      if (!address) { setPerm('loading'); return }
      const isOwner = !!(d.org.ownerWallet && d.org.ownerWallet.toLowerCase() === address.toLowerCase())
      const canPay = isOwner || (d.member?.status === 'active' && policyForRole(d.member.role).canPayVendors)
      setPerm(canPay ? 'allowed' : 'denied')
    }).catch(() => {})
  }, [slug, address])

  const rows = useMemo(() => parseCsv(csv), [csv])
  const valid = rows.filter((r) => r.ok)
  const total = valid.reduce((s, r) => s + r.usd, 0)
  const badCount = rows.length - valid.length

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    f.text().then(setCsv)
  }

  const run = async () => {
    if (!orgId || !address || valid.length === 0) return
    setBusy(true); setResult(null)
    try {
      const res = await signedOrgFetch({
        path: `/api/orgs/${orgId}/pay`, action: 'mintware-org-pay',
        payload: { payments: valid.map((r) => ({ to: r.to, amountUsdc: r.amountUsdc })), category: category || 'Payroll' }, address, signMessageAsync,
      })
      const d = await res.json()
      if (res.ok && d.ok) setResult({ ok: true, text: `Recorded ✓ — ${valid.length} recipients · $${total.toFixed(2)} total, as one batch in your treasury ledger. On-chain settlement lands with the treasury settle path.` })
      else setResult({ ok: false, text: d.error || d.message || 'Payroll failed.' })
    } catch (e) { setResult({ ok: false, text: String(e) }) } finally { setBusy(false) }
  }

  return (
    <MwAuthGuard>
      <div className="min-h-screen font-atx-display bg-white text-ink">
        <MwNav />
        <main className="mx-auto max-w-[720px] px-6 max-[700px]:px-4 py-[44px]">
          <Link href={`/app/org/${slug}`} className="text-[12.5px] text-peri-deep no-underline hover:underline">← {orgName || 'Org'}</Link>
          <h1 className="font-atx-display font-semibold text-[26px] tracking-[-0.03em] mt-3">Run payroll</h1>
          <p className="text-[13px] text-ink-mid mt-1.5">Paste or upload a CSV of <code className="font-mono text-[12px]">wallet, amount</code>. One batch settlement from the treasury.</p>

          {perm === 'denied' ? (
            <div className="soft-card p-6 mt-6 text-[13.5px] text-ink-mid leading-[1.55]">
              Running payroll draws from the treasury, so it&apos;s limited to the <span className="font-semibold text-ink">owner</span> and <span className="font-semibold text-ink">managers</span>. Ask an owner if you need to run a batch.
            </div>
          ) : perm === 'loading' ? (
            <div className="soft-card p-6 mt-6 text-[13px] text-ink-soft">Checking your permissions…</div>
          ) : (
            <>
              <div className="soft-card p-5 mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Recipients CSV</span>
                  <label className="text-[12px] text-peri-deep cursor-pointer hover:underline">upload .csv<input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" /></label>
                </div>
                <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={7} placeholder={'0xabc…,1200.00\n0xdef…,850'} className="w-full rounded-[10px] border border-hair px-3 py-2.5 text-[13px] font-mono outline-none focus:border-peri resize-y" />
                <label className="block mt-3"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Category <span className="text-ink-soft/70 normal-case tracking-normal font-normal">· labels the whole run in reports</span></span>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Payroll" maxLength={80} className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] outline-none focus:border-peri" />
                </label>
              </div>

              {rows.length > 0 && (
                <div className="soft-card mt-4 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-hair-soft">
                    <span className="text-[13px] font-semibold text-ink">{valid.length} valid{badCount > 0 ? ` · ${badCount} skipped` : ''}</span>
                    <span className="text-[15px] font-semibold text-ink tabular-nums">${total.toFixed(2)}</span>
                  </div>
                  <div className="max-h-[240px] overflow-y-auto">
                    {rows.slice(0, 100).map((r, i) => (
                      <div key={i} className={`flex items-center gap-3 px-5 py-2 border-b border-hair-soft last:border-b-0 text-[13px] ${r.ok ? '' : 'opacity-45'}`}>
                        <span className="font-mono text-ink flex-1 truncate">{r.to || '—'}</span>
                        <span className="tabular-nums text-ink">{r.ok ? `$${r.usd.toFixed(2)}` : 'invalid'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={run} disabled={busy || valid.length === 0} className="mt-4 rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">{busy ? 'Recording…' : `Pay ${valid.length || ''} in one batch`}</button>
              {result && <div className={`mt-4 rounded-[var(--radius-card)] border p-4 text-[13px] leading-[1.5] ${result.ok ? 'border-[rgba(42,158,138,0.3)] bg-mw-green-muted' : 'border-[rgba(194,83,122,0.3)] bg-white'} text-ink`}>{result.text}</div>}
            </>
          )}
        </main>
      </div>
    </MwAuthGuard>
  )
}

'use client'

// Run payroll (#5) — paste or upload a {wallet, amount} CSV, preview the batch + total, settle as ONE
// batch payment from the treasury. NOT a scheduler or HR suite — CSV in, one batch out. Chrome comes
// from the shared TeamTerminalShell layout.

import { type ChangeEvent, use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { PageHead, IconBatch } from '@/components/web2/TeamKit'
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
      if (res.ok && d.ok) setResult({ ok: true, text: `Recorded ✓ ${valid.length} recipients, $${total.toFixed(2)} total, as one batch in your treasury ledger. Nothing has been sent on-chain yet.` })
      else setResult({ ok: false, text: d.error || d.message || 'Payroll failed.' })
    } catch (e) { setResult({ ok: false, text: String(e) }) } finally { setBusy(false) }
  }

  return (
    <MwAuthGuard>
      <div className="max-w-[720px] mx-auto">
        <PageHead
          back={{ href: `/app/org/${slug}`, label: orgName || 'Org' }}
          icon={<IconBatch size={24} />}
          title="Run payroll"
          status={{ tone: 'building', label: 'Records only' }}
          lede={<>Paste or upload a CSV of <code className="font-geist-mono text-[13.5px]">wallet, amount</code>, check the batch, then record it as one entry in your treasury ledger. Paying recipients on-chain isn&apos;t built yet.</>}
        />

        {perm === 'denied' ? (
          <div className="mw-inset rounded-[20px] p-6 mt-7 text-[14px] text-ink-mid leading-[1.55]">
            Running payroll draws from the treasury, so it&apos;s limited to the <span className="font-semibold text-ink">owner</span> and <span className="font-semibold text-ink">managers</span>. Ask an owner if you need to run a batch.
          </div>
        ) : perm === 'loading' ? (
          <div className="mw-inset rounded-[20px] p-6 mt-7 text-[14px] text-ink-soft">Checking your permissions…</div>
        ) : (
          <>
            <div className="mw-raise rounded-[24px] p-6 mt-7">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-ink-mid"><span className="font-geist-mono text-ink-soft mr-1.5">1</span>Recipients CSV</span>
                <label className="mw-btn-quiet !min-h-[36px] text-[13px] cursor-pointer">Upload .csv<input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" /></label>
              </div>
              <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={7} placeholder={'0xabc…,1200.00\n0xdef…,850'} className="w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 py-3 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[13.5px] font-geist-mono resize-y" />
              <label className="block mt-3"><span className="text-[13px] font-semibold text-ink-mid">Category <span className="text-ink-soft/70 normal-case tracking-normal font-normal">· labels the whole run in reports</span></span>
                <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Payroll" maxLength={80} className="mt-1.5 w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px]" />
              </label>
            </div>

            {rows.length > 0 && (
              <div className="mw-raise rounded-[24px] mt-4 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--mw-line)' }}>
                  <span className="text-[14px] font-semibold text-ink"><span className="font-geist-mono text-ink-soft mr-1.5">2</span>{valid.length} valid{badCount > 0 ? ` · ${badCount} skipped` : ''}</span>
                  <span className="font-geist-mono text-[17px] text-ink">${total.toFixed(2)}</span>
                </div>
                <div className="max-h-[240px] overflow-y-auto">
                  {rows.slice(0, 100).map((r, i) => (
                    <div key={i} className={`flex items-center gap-3 px-5 py-2 border-b border-hair-soft last:border-b-0 text-[13px] ${r.ok ? '' : 'opacity-45'}`}>
                      <span className="font-mono text-ink flex-1 truncate">{r.to || '—'}</span>
                      <span className={`font-geist-mono ${r.ok ? 'text-ink' : 'text-[#B42318]'}`}>{r.ok ? `$${r.usd.toFixed(2)}` : 'invalid'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={run} disabled={busy || valid.length === 0} className="mt-4 mw-btn !min-h-[48px] disabled:opacity-50 disabled:cursor-default">{busy ? 'Recording…' : valid.length ? `Record ${valid.length} payment${valid.length === 1 ? '' : 's'} as one batch` : 'Record batch'}</button>
            {result && <div role="status" className={`mt-4 rounded-[16px] px-4 py-3 text-[14px] leading-[1.5] ${result.ok ? 'bg-[#E3F4EA] text-[#0F5F37]' : 'bg-[#FBE9E7] text-[#B42318]'}`}>{result.text}</div>}
          </>
        )}
      </div>
    </MwAuthGuard>
  )
}

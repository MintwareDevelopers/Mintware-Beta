'use client'

// Treasury activity — the unified spend ledger UI (Phase 2 reporting). One signed fetch pulls the org's
// spend (vendor pay + payroll + cards) from /api/orgs/[id]/spend; filtering, rollups, totals, and CSV
// export all run client-side over that set, so reporting is instant and needs only one signature.

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'

interface Row {
  id: string
  source: 'ledger' | 'card'
  spendType: string
  status: 'recorded' | 'settled' | 'failed'
  initiatedBy: string | null
  recipient: string | null
  amountAtomic: string
  category: string | null
  memo: string | null
  settled: boolean
  settleTx: string | null
  createdAt: string
}

const usd = (atomic: string) => {
  let n = 0
  try { n = Number(BigInt(atomic)) / 1e6 } catch { n = 0 }
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const short = (a?: string | null) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? '—')
const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return iso } }
const TYPE_LABEL: Record<string, string> = { vendor_pay: 'Vendor', payroll: 'Payroll', card_swipe: 'Card', x402: 'x402', deposit: 'Deposit', withdraw: 'Withdraw' }

const STATUS_STYLE: Record<string, string> = {
  settled: 'bg-mw-green-muted text-mw-green',
  recorded: 'bg-[rgba(108,108,240,0.11)] text-peri-deep',
  failed: 'bg-[rgba(194,83,122,0.12)] text-[#B4436A]',
}

export default function ActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address } = useMintwareIdentity()
  const { signMessageAsync } = useSignMessage()

  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  // filters (all client-side)
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [groupBy, setGroupBy] = useState<'category' | 'member' | 'month'>('category')

  useEffect(() => {
    fetch(`/api/orgs/${slug}/treasury`).then((r) => r.json()).then((d) => { if (d?.org) { setOrgId(d.org.id); setOrgName(d.org.name) } }).catch(() => {})
  }, [slug])

  const load = async () => {
    if (!orgId || !address) return
    setLoading(true); setErr('')
    try {
      const res = await signedOrgFetch({ path: `/api/orgs/${orgId}/spend`, action: 'mintware-org-spend', payload: { limit: 500 }, address, signMessageAsync })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'Could not load activity.'); setRows([]); return }
      setRows((d.rows as Row[]) ?? [])
    } catch (e) { setErr(String(e)); setRows([]) } finally { setLoading(false) }
  }
  useEffect(() => { if (orgId && address) void load() }, [orgId, address]) // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.category).filter(Boolean))) as string[], [rows])

  const filtered = useMemo(() => {
    let x = rows ?? []
    if (type) x = x.filter((r) => r.spendType === type)
    if (status) x = x.filter((r) => r.status === status)
    if (category) x = x.filter((r) => (r.category ?? '') === category)
    if (from) x = x.filter((r) => r.createdAt >= from)
    if (to) x = x.filter((r) => r.createdAt <= to + 'T23:59:59Z')
    if (q) {
      const s = q.toLowerCase()
      x = x.filter((r) => [r.recipient, r.memo, r.category, r.initiatedBy].some((v) => (v ?? '').toLowerCase().includes(s)))
    }
    return x
  }, [rows, type, status, category, from, to, q])

  const monthLabel = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 7) } }

  const { totalAtomic, count, rollup } = useMemo(() => {
    let total = 0n
    const m = new Map<string, { label: string; v: bigint; sort: string }>()
    const keyOf = (r: Row): { key: string; label: string; sort: string } => {
      if (groupBy === 'member') { const k = r.initiatedBy ?? 'unknown'; return { key: k, label: short(k), sort: k } }
      if (groupBy === 'month') { const s = r.createdAt.slice(0, 7); return { key: s, label: monthLabel(r.createdAt), sort: s } }
      const k = r.category ?? 'Uncategorized'; return { key: k, label: k, sort: k }
    }
    for (const r of filtered) {
      if (r.status === 'failed') continue
      let amt: bigint
      try { amt = BigInt(r.amountAtomic) } catch { continue }
      total += amt
      const { key, label, sort } = keyOf(r)
      const cur = m.get(key) ?? { label, v: 0n, sort }
      cur.v += amt; m.set(key, cur)
    }
    // Months sort newest-first by their sort key; everything else sorts by amount desc.
    const rows = Array.from(m.values()).map((x) => ({ k: x.label, v: x.v.toString(), sort: x.sort }))
    rows.sort(groupBy === 'month' ? (a, b) => (a.sort < b.sort ? 1 : -1) : (a, b) => (BigInt(a.v) < BigInt(b.v) ? 1 : -1))
    return { totalAtomic: total.toString(), count: filtered.length, rollup: rows }
  }, [filtered, groupBy]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    const head = ['date', 'type', 'recipient', 'category', 'memo', 'initiated_by', 'amount_usdc', 'status', 'settle_tx']
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = filtered.map((r) => [
      new Date(r.createdAt).toISOString(), TYPE_LABEL[r.spendType] ?? r.spendType, r.recipient ?? '',
      r.category ?? '', r.memo ?? '', r.initiatedBy ?? '', usd(r.amountAtomic), r.status, r.settleTx ?? '',
    ].map(esc).join(','))
    const csv = [head.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${orgName || 'treasury'}-spend-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  const inputCls = 'rounded-[10px] border border-hair bg-white px-3 py-2 text-[13px] outline-none focus:border-peri'

  return (
    <MwAuthGuard>
      <div className="min-h-screen bg-white font-atx-display text-ink">
        <MwNav />
        <main className="mx-auto max-w-[1040px] px-6 max-[700px]:px-4 py-[44px]">
          <Link href={`/app/org/${slug}`} className="text-[13px] text-ink-soft hover:text-ink no-underline">← {orgName || 'Org'}</Link>
          <div className="flex items-end justify-between gap-4 flex-wrap mt-2">
            <div>
              <h1 className="font-atx-display font-semibold text-[clamp(1.6rem,3.4vw,2.1rem)] tracking-[-0.03em]">Activity</h1>
              <p className="text-ink-mid text-[13.5px] mt-1">Every payment from the treasury — vendor pay, payroll, and cards, in one ledger.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={load} disabled={loading} className="glass-pill glass-pill-sm disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
              <button onClick={exportCsv} disabled={!filtered.length} className="glass-pill glass-pill-sm disabled:opacity-40">Export CSV</button>
            </div>
          </div>

          {/* summary + category rollup */}
          <div className="grid grid-cols-[1fr_1.4fr] gap-3 mt-6 max-[720px]:grid-cols-1">
            <div className="soft-card p-5">
              <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Total spend {(from || to || type || status || category || q) ? '· filtered' : ''}</div>
              <div className="font-atx-display font-semibold text-[clamp(1.8rem,4vw,2.6rem)] tracking-[-0.03em] tabular-nums mt-1">${usd(totalAtomic)}</div>
              <div className="text-[12.5px] text-ink-soft mt-1">{count} payment{count === 1 ? '' : 's'}</div>
            </div>
            <div className="soft-card p-5">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">By {groupBy}</div>
                <div className="flex gap-1">
                  {(['category', 'member', 'month'] as const).map((g) => (
                    <button key={g} onClick={() => setGroupBy(g)} className={`text-[11px] font-semibold rounded-full px-2.5 py-1 transition-colors ${groupBy === g ? 'bg-peri text-white' : 'bg-ground-cool text-ink-mid hover:text-ink'}`}>{g[0].toUpperCase() + g.slice(1)}</button>
                  ))}
                </div>
              </div>
              {rollup.length === 0 ? <div className="text-[13px] text-ink-soft">No spend yet.</div> : (
                <div className="flex flex-col gap-2">
                  {rollup.slice(0, 6).map(({ k, v }) => {
                    const pct = totalAtomic === '0' ? 0 : Number((BigInt(v) * 100n) / (BigInt(totalAtomic) || 1n))
                    return (
                      <div key={k} className="flex items-center gap-3">
                        <span className="text-[12.5px] text-ink w-[112px] truncate">{k}</span>
                        <span className="flex-1 h-2 rounded-full bg-ground-cool overflow-hidden"><span className="block h-full rounded-full bg-peri" style={{ width: `${Math.max(4, pct)}%` }} /></span>
                        <span className="text-[12.5px] font-mono text-ink-mid tabular-nums w-[84px] text-right">${usd(v)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* filters */}
          <div className="flex gap-2 mt-5 flex-wrap items-center">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipient, memo, category…" className={`${inputCls} flex-1 min-w-[200px]`} />
            <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}><option value="">All types</option><option value="vendor_pay">Vendor</option><option value="payroll">Payroll</option><option value="card_swipe">Card</option></select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}><option value="">Any status</option><option value="settled">Settled</option><option value="recorded">Recorded</option><option value="failed">Failed</option></select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} aria-label="from date" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} aria-label="to date" />
          </div>

          {/* feed */}
          <div className="soft-card mt-4 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px] min-w-[720px]">
                <thead>
                  <tr className="bg-ground-cool">
                    {['Date', 'Type', 'Recipient', 'Category', 'By', 'Amount', 'Status'].map((h) => (
                      <th key={h} className={`text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-soft px-3.5 py-2.5 border-b border-hair ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows === null ? (
                    <tr><td colSpan={7} className="px-3.5 py-10 text-center text-ink-soft text-[13px]">{loading ? 'Loading…' : ''}</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="px-3.5 py-10 text-center text-ink-soft text-[13px]">{err || 'No spend matches these filters yet.'}</td></tr>
                  ) : filtered.map((r) => (
                    <tr key={`${r.source}-${r.id}`} className="border-b border-hair-soft last:border-0">
                      <td className="px-3.5 py-2.5 text-ink-mid whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                      <td className="px-3.5 py-2.5"><span className="text-[10px] uppercase tracking-[0.05em] font-semibold rounded-full border border-hair bg-ground-cool px-2 py-0.5 text-ink-mid">{TYPE_LABEL[r.spendType] ?? r.spendType}</span></td>
                      <td className="px-3.5 py-2.5 font-mono text-[12.5px] text-ink">{r.source === 'card' ? (r.recipient ?? '—') : short(r.recipient)}{r.memo && <span className="block font-sans text-[11px] text-ink-soft not-italic truncate max-w-[220px]">{r.memo}</span>}</td>
                      <td className="px-3.5 py-2.5 text-ink-mid">{r.category ?? '—'}</td>
                      <td className="px-3.5 py-2.5 font-mono text-[12px] text-ink-soft">{short(r.initiatedBy)}</td>
                      <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-ink">${usd(r.amountAtomic)}</td>
                      <td className="px-3.5 py-2.5">
                        {r.settleTx ? (
                          <a href={`https://sepolia.basescan.org/tx/${r.settleTx}`} target="_blank" rel="noreferrer" className={`inline-block text-[10px] uppercase tracking-[0.05em] font-semibold rounded-full px-2 py-0.5 no-underline ${STATUS_STYLE[r.status]}`}>{r.status} ↗</a>
                        ) : (
                          <span className={`inline-block text-[10px] uppercase tracking-[0.05em] font-semibold rounded-full px-2 py-0.5 ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11.5px] text-ink-soft mt-4">Recorded payments are in your ledger; “settled” means the on-chain transaction confirmed. Testnet — no real value moves yet.</p>
        </main>
      </div>
    </MwAuthGuard>
  )
}

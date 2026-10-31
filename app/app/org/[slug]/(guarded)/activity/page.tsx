'use client'

// Treasury activity — the unified spend ledger UI (Phase 2 reporting). One signed fetch pulls the org's
// spend (vendor pay + payroll + cards) from /api/orgs/[id]/spend; filtering, rollups, totals, and CSV
// export all run client-side over that set, so reporting is instant and needs only one signature.
// Chrome comes from the shared TeamTerminalShell layout.

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { PageHead, StatusChip, Note, IconLedger } from '@/components/web2/TeamKit'
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

// Status in the material: settled = solid (confirmed on-chain), recorded = dotted (in the ledger, not yet sent).
const STATUS_TONE: Record<string, 'live' | 'building' | 'bad'> = { settled: 'live', recorded: 'building', failed: 'bad' }

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

  const inputCls = 'rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[42px] px-3 text-[14px] outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6]'

  return (
    <MwAuthGuard>
      <div className="max-w-[1040px] mx-auto">
        <PageHead
          back={{ href: `/app/org/${slug}`, label: orgName || 'Org' }}
          icon={<IconLedger size={24} />}
          title="Activity"
          lede="Every payment from the treasury (vendor pay, payroll and cards) in one ledger. Filter it, roll it up, export it."
          actions={<>
            <button onClick={load} disabled={loading} className="mw-btn-quiet !min-h-[40px] disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
            <button onClick={exportCsv} disabled={!filtered.length} className="mw-btn !min-h-[40px] disabled:opacity-40 disabled:cursor-default">Export CSV</button>
          </>}
        />

        {/* summary + category rollup */}
        <div className="grid grid-cols-[1fr_1.4fr] gap-3 mt-6 max-[720px]:grid-cols-1">
          <div className="mw-raise-lg relative overflow-hidden rounded-[24px] p-6">
            <div aria-hidden className="absolute -right-16 -top-20 w-56 h-56 rounded-full opacity-25 blur-[48px]" style={{ background: 'var(--mw-sheen)' }} />
            <div className="relative text-[13px] font-semibold text-ink-mid">Total spend {(from || to || type || status || category || q) ? '· filtered' : ''}</div>
            <div className="relative font-geist-mono text-[clamp(32px,4.4vw,46px)] tracking-[-0.04em] mt-1.5">${usd(totalAtomic)}</div>
            <div className="relative text-[13px] text-ink-soft mt-1">{count} payment{count === 1 ? '' : 's'}</div>
          </div>
          <div className="mw-raise rounded-[24px] p-6">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="text-[13px] font-semibold text-ink-mid">By {groupBy}</div>
              <div className="flex gap-0.5 p-1 rounded-[12px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
                {(['category', 'member', 'month'] as const).map((g) => (
                  <button key={g} onClick={() => setGroupBy(g)} aria-pressed={groupBy === g} className="text-[12.5px] font-semibold rounded-[9px] px-2.5 py-1 border-0 cursor-pointer transition-colors" style={groupBy === g ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { background: 'transparent', color: 'var(--mw-ink-2)' }}>{g[0].toUpperCase() + g.slice(1)}</button>
                ))}
              </div>
            </div>
            {rollup.length === 0 ? <div className="text-[14px] text-ink-soft">No spend yet.</div> : (
              <div className="flex flex-col gap-2">
                {rollup.slice(0, 6).map(({ k, v }) => {
                  const pct = totalAtomic === '0' ? 0 : Number((BigInt(v) * 100n) / (BigInt(totalAtomic) || 1n))
                  return (
                    <div key={k} className="flex items-center gap-3">
                      <span className="text-[13px] text-ink w-[112px] truncate">{k}</span>
                      <span className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}><span className="block h-full rounded-full" style={{ width: `${Math.max(4, pct)}%`, background: '#7C7AF0' }} /></span>
                      <span className="text-[13px] font-geist-mono text-ink-mid w-[90px] text-right">${usd(v)}</span>
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
        <div className="mw-raise rounded-[22px] mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px] min-w-[720px]">
              <thead>
                <tr style={{ background: 'var(--mw-ground)' }}>
                  {['Date', 'Type', 'Recipient', 'Category', 'By', 'Amount', 'Status'].map((h) => (
                    <th key={h} className={`text-[12px] font-semibold text-ink-soft px-4 py-3 border-b border-[rgba(21,21,29,.08)] ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows === null ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-ink-soft text-[14px]">{loading ? 'Loading…' : ''}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-ink-soft text-[14px]">{err || 'No spend matches these filters yet.'}</td></tr>
                ) : filtered.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className="border-b border-[rgba(21,21,29,.06)] last:border-0">
                    <td className="px-4 py-3 text-ink-mid whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                    <td className="px-4 py-3"><StatusChip tone="muted">{TYPE_LABEL[r.spendType] ?? r.spendType}</StatusChip></td>
                    <td className="px-4 py-3 font-geist-mono text-[13px] text-ink">{r.source === 'card' ? (r.recipient ?? '—') : short(r.recipient)}{r.memo && <span className="block font-sans text-[11px] text-ink-soft not-italic truncate max-w-[220px]">{r.memo}</span>}</td>
                    <td className="px-4 py-3 text-ink-mid">{r.category ?? '—'}</td>
                    <td className="px-4 py-3 font-geist-mono text-[12.5px] text-ink-soft">{short(r.initiatedBy)}</td>
                    <td className="px-4 py-3 text-right font-geist-mono text-ink">${usd(r.amountAtomic)}</td>
                    <td className="px-4 py-3">
                      {r.settleTx ? (
                        <a href={`https://sepolia.basescan.org/tx/${r.settleTx}`} target="_blank" rel="noreferrer" className="no-underline"><StatusChip tone={STATUS_TONE[r.status] ?? 'muted'} className="capitalize">{r.status} ↗</StatusChip></a>
                      ) : (
                        <StatusChip tone={STATUS_TONE[r.status] ?? 'muted'} className="capitalize">{r.status}</StatusChip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Note>Recorded payments are in your ledger; settled means the on-chain transaction confirmed. Testnet: no real value moves yet.</Note>
      </div>
    </MwAuthGuard>
  )
}

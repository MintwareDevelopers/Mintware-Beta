'use client'

// Curator dashboard — the auto-surfaced candidate queue (ranked safest-first) with one-click
// Approve/Reject. The curator secret is entered here and sent as the bearer to /api/gateway/curate;
// the risk score RANKS the queue, it never certifies safety, so every pool is a human decision.

import { useCallback, useEffect, useState } from 'react'

type Candidate = {
  id: string
  pool_address: string
  chain_id: number
  pair_label: string | null
  source: string
  risk_score: number | null
  risk_signals: { reasons?: string[] } | null
  hotness: { tvlUsd?: number; vol24Usd?: number; volTvlRatio?: number } | null
}

const usd = (n?: number) =>
  n == null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`

export default function CuratePage() {
  const [queue, setQueue] = useState<Candidate[]>([])
  const [secret, setSecret] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/gateway/curate')
      .then((r) => r.json())
      .then((d) => setQueue(Array.isArray(d?.queue) ? d.queue : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  async function act(id: string, action: 'approve' | 'reject') {
    if (!secret) { setMsg('Enter the curator secret first.'); return }
    setBusy(id)
    setMsg('')
    try {
      const res = await fetch('/api/gateway/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ requestId: id, action }),
      })
      const d = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !d.success) throw new Error(d.error ?? 'failed')
      load()
    } catch (e) {
      setMsg(String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  const riskColor = (s: number | null) =>
    s == null ? 'text-ink-soft' : s < 20 ? 'text-mw-green' : s < 50 ? 'text-mw-amber' : 'text-mw-red'

  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen">
      <div className="mx-auto max-w-[860px] px-7 max-[640px]:px-[18px] py-[56px]">
        <div className="text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep">Curator</div>
        <h1 className="font-atx-display font-semibold text-[26px] tracking-[-0.02em] mt-2">Pool candidate queue</h1>
        <p className="text-[13.5px] text-ink-mid mt-1.5 max-w-[60ch]">
          Auto-surfaced from the hottest pools, ranked safest-first. The score ranks the queue — it does
          not certify safety (no honeypot/hook sim). Every approve is your call.
        </p>

        <div className="flex gap-2.5 mt-5 max-[520px]:flex-col">
          <input
            type="password"
            placeholder="Curator secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="flex-1 py-2.5 px-4 rounded-full bg-white border border-hair text-[13.5px] outline-none focus:border-[rgba(108,108,240,0.5)]"
          />
          <button onClick={load} className="glass-pill whitespace-nowrap">Refresh</button>
        </div>
        {msg && <div className="text-[12.5px] text-mw-red mt-2">{msg}</div>}

        <div className="mt-6 flex flex-col gap-3">
          {loading ? (
            <div className="text-[14px] text-ink-soft">Loading queue…</div>
          ) : queue.length === 0 ? (
            <div className="soft-card p-5 text-[14px] text-ink-mid">
              Nothing pending. The discover cron populates this from the hottest pools.
            </div>
          ) : (
            queue.map((c) => (
              <div key={c.id} className="soft-card p-[18px] flex items-start justify-between gap-4 max-[560px]:flex-col">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-semibold text-[16px]">{c.pair_label ?? c.pool_address.slice(0, 12)}</span>
                    <span className={`font-mono text-[13px] font-bold ${riskColor(c.risk_score)}`}>
                      risk {c.risk_score ?? '—'}
                    </span>
                    <span className="text-[10.5px] uppercase tracking-[0.06em] font-semibold text-ink-soft bg-[rgba(15,20,32,0.05)] rounded px-1.5 py-0.5">
                      {c.source}
                    </span>
                  </div>
                  <div className="text-[12px] text-ink-mid mt-1.5 flex gap-3.5 flex-wrap font-mono">
                    <span>TVL {usd(c.hotness?.tvlUsd)}</span>
                    <span>vol24 {usd(c.hotness?.vol24Usd)}</span>
                    <span>v/TVL {c.hotness?.volTvlRatio != null ? c.hotness.volTvlRatio.toFixed(1) + '×' : '—'}</span>
                  </div>
                  {c.risk_signals?.reasons && c.risk_signals.reasons.length > 0 && (
                    <div className="text-[11.5px] text-ink-soft mt-1.5">{c.risk_signals.reasons.join(' · ')}</div>
                  )}
                  <div className="text-[10.5px] text-ink-soft mt-1.5 font-mono">{c.pool_address}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => act(c.id, 'approve')}
                    disabled={busy === c.id}
                    className="rounded-full bg-[#16a34a] text-white text-[13px] font-semibold px-4 py-2 disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => act(c.id, 'reject')}
                    disabled={busy === c.id}
                    className="rounded-full bg-white border border-hair text-ink-mid text-[13px] font-semibold px-4 py-2 disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <p className="text-[11.5px] text-ink-soft mt-6 leading-[1.5] max-w-[64ch]">
          Approve records the decision. Deploying the gateway (the factory tx) + registering the live
          instance is the operator step from the runbook — an approve carrying the deployed addresses
          registers it in one call.
        </p>
      </div>
    </div>
  )
}

'use client'

// Curator dashboard — the auto-surfaced candidate queue (ranked safest-first) with Approve / Reject,
// an optional "approve + register" (deployed PM + staging addresses → on-chain verified against the
// trust root), and a live-instance list with an explicit, reasoned Deactivate.
//
// Audit closeout 2026-09-08 (O-3 / R-2): there is NO secret field any more. The curator connects an
// allowlisted wallet (`LP_GATEWAY_CURATORS`) and SIGNS each action (EIP-191, action- and payload-bound);
// /api/gateway/curate rebuilds the exact message and strict-compares it. The risk score RANKS the queue,
// it never certifies safety, so every pool is a human decision.

import { useCallback, useEffect, useState } from 'react'
import { useSignMessage } from 'wagmi'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { buildGatewayCurateMessage, type CurateAction } from '@/lib/gateway/curateAuth'

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
type Instance = {
  id: string
  poolAddress: string
  chainId: number
  pairLabel: string | null
  positionManager: string
  staging: string
  status: 'active' | 'inactive'
  verification: string | null
}

const usd = (n?: number) =>
  n == null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`

export default function CuratePage() {
  const { address, isConnected } = useMintwareIdentity()
  const { signMessageAsync } = useSignMessage()
  const [queue, setQueue] = useState<Candidate[]>([])
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [registerFor, setRegisterFor] = useState<string | null>(null)
  const [pm, setPm] = useState('')
  const [staging, setStaging] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/gateway/curate').then((r) => r.json()).then((d) => setQueue(Array.isArray(d?.queue) ? d.queue : [])),
      fetch('/api/gateway/instances?all=1').then((r) => r.json()).then((d) => setInstances(Array.isArray(d?.instances) ? d.instances : [])),
    ])
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  /** Sign + POST one curator action. The message is the same canonical payload the server rebuilds. */
  async function signed(input: {
    curateAction: CurateAction
    requestId?: string | null
    poolAddress?: string | null
    chainId?: number | null
    instance?: { positionManager: string; staging: string } | null
    reason?: string
  }) {
    if (!address) throw new Error('Connect the curator wallet first.')
    const issuedAt = Date.now()
    const authMessage = buildGatewayCurateMessage({
      address,
      issuedAt,
      curateAction: input.curateAction,
      requestId: input.requestId ?? null,
      poolAddress: input.poolAddress ?? null,
      chainId: input.chainId ?? null,
      positionManager: input.instance?.positionManager ?? null,
      staging: input.instance?.staging ?? null,
    })
    const authSignature = await signMessageAsync({ message: authMessage })
    const res = await fetch('/api/gateway/curate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address,
        authMessage,
        authSignature,
        issuedAt,
        action: input.curateAction,
        requestId: input.requestId ?? undefined,
        poolAddress: input.poolAddress ?? undefined,
        chainId: input.chainId ?? undefined,
        instance: input.instance ?? undefined,
        reason: input.reason,
      }),
    })
    const d = (await res.json()) as { success?: boolean; error?: string; detail?: string }
    if (!res.ok || !d.success) throw new Error(d.detail ? `${d.error}: ${d.detail}` : d.error ?? 'failed')
    return d
  }

  async function act(c: Candidate, action: 'approve' | 'reject') {
    setBusy(c.id)
    setMsg('')
    try {
      const withInstance = action === 'approve' && registerFor === c.id && pm && staging
      await signed({
        curateAction: action,
        requestId: c.id,
        poolAddress: c.pool_address,
        chainId: c.chain_id,
        instance: withInstance ? { positionManager: pm.trim(), staging: staging.trim() } : null,
      })
      setRegisterFor(null)
      setPm('')
      setStaging('')
      load()
    } catch (e) {
      setMsg(String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  async function deactivate(i: Instance) {
    const reason = window.prompt(`Deactivate ${i.pairLabel ?? short(i.poolAddress)}? Give a reason (logged):`)
    if (!reason?.trim()) return
    setBusy(i.id)
    setMsg('')
    try {
      await signed({ curateAction: 'deactivate', poolAddress: i.poolAddress, chainId: i.chainId, reason: reason.trim() })
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
          not certify safety (no honeypot/hook sim). Every approve is your call, and every action is a
          wallet signature from an allowlisted curator.
        </p>

        <div className="flex items-center gap-2.5 mt-5 max-[520px]:flex-col max-[520px]:items-start">
          <div className="flex-1 py-2.5 px-4 rounded-full bg-white border border-hair text-[13px] font-mono text-ink-mid">
            {isConnected && address ? `Curator wallet ${short(address)}` : 'Connect the curator wallet (allowlisted) to act'}
          </div>
          <button onClick={load} className="glass-pill whitespace-nowrap">Refresh</button>
        </div>
        {msg && <div className="text-[12.5px] text-mw-red mt-2 break-all">{msg}</div>}

        <div className="mt-6 flex flex-col gap-3">
          {loading ? (
            <div className="text-[14px] text-ink-soft">Loading queue…</div>
          ) : queue.length === 0 ? (
            <div className="soft-card p-5 text-[14px] text-ink-mid">
              Nothing pending. The discover cron populates this from the hottest pools.
            </div>
          ) : (
            queue.map((c) => (
              <div key={c.id} className="soft-card p-[18px] flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4 max-[560px]:flex-col">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-[16px]">{c.pair_label ?? c.pool_address.slice(0, 12)}</span>
                      <span className={`font-mono text-[13px] font-bold ${riskColor(c.risk_score)}`}>risk {c.risk_score ?? '—'}</span>
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
                    <div className="text-[10.5px] text-ink-soft mt-1.5 font-mono break-all">{c.pool_address}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => act(c, 'approve')}
                      disabled={busy === c.id || !isConnected}
                      className="rounded-full bg-[#16a34a] text-white text-[13px] font-semibold px-4 py-2 disabled:opacity-60"
                    >
                      {registerFor === c.id && pm && staging ? 'Approve + register' : 'Approve'}
                    </button>
                    <button
                      onClick={() => act(c, 'reject')}
                      disabled={busy === c.id || !isConnected}
                      className="rounded-full bg-white border border-hair text-ink-mid text-[13px] font-semibold px-4 py-2 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                <div>
                  <button
                    onClick={() => { setRegisterFor(registerFor === c.id ? null : c.id); setPm(''); setStaging('') }}
                    className="text-[12px] text-peri-deep underline underline-offset-2"
                  >
                    {registerFor === c.id ? 'Cancel register' : 'Also register the deployed instance…'}
                  </button>
                  {registerFor === c.id && (
                    <div className="mt-2 flex flex-col gap-2">
                      <input
                        placeholder="Deployed PositionManager (0x…)"
                        value={pm}
                        onChange={(e) => setPm(e.target.value)}
                        className="py-2 px-3.5 rounded-full bg-white border border-hair text-[12.5px] font-mono outline-none focus:border-[rgba(108,108,240,0.5)]"
                      />
                      <input
                        placeholder="Deployed Staging (0x…)"
                        value={staging}
                        onChange={(e) => setStaging(e.target.value)}
                        className="py-2 px-3.5 rounded-full bg-white border border-hair text-[12.5px] font-mono outline-none focus:border-[rgba(108,108,240,0.5)]"
                      />
                      <div className="text-[11px] text-ink-soft leading-[1.5]">
                        Verified on-chain before anything is written: factory record or allowlisted code hash,
                        staging wiring, platform USDG, no hooks. An already-active pool is refused — deactivate it first.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <h2 className="font-atx-display font-semibold text-[18px] tracking-[-0.01em] mt-10">Registered instances</h2>
        <p className="text-[12.5px] text-ink-mid mt-1 max-w-[60ch]">
          The deposit-routing trust root. Deactivating is explicit and logged; a deactivated pool stays
          withdraw-only until a verified instance is registered again.
        </p>
        <div className="mt-4 flex flex-col gap-2.5">
          {instances.length === 0 ? (
            <div className="soft-card p-4 text-[13px] text-ink-mid">No instances registered.</div>
          ) : (
            instances.map((i) => (
              <div key={i.id} className="soft-card p-4 flex items-center justify-between gap-3 max-[560px]:flex-col max-[560px]:items-start">
                <div className="min-w-0 text-[12.5px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[14px]">{i.pairLabel ?? short(i.poolAddress)}</span>
                    <span className={`text-[10.5px] uppercase tracking-[0.06em] font-semibold rounded px-1.5 py-0.5 ${i.status === 'active' ? 'text-mw-green bg-[rgba(22,163,74,0.08)]' : 'text-ink-soft bg-[rgba(15,20,32,0.05)]'}`}>
                      {i.status}
                    </span>
                    {i.verification && <span className="text-[10.5px] font-mono text-ink-soft">via {i.verification}</span>}
                  </div>
                  <div className="font-mono text-[11px] text-ink-soft mt-1 break-all">PM {i.positionManager} · staging {i.staging}</div>
                </div>
                {i.status === 'active' && (
                  <button
                    onClick={() => deactivate(i)}
                    disabled={busy === i.id || !isConnected}
                    className="rounded-full bg-white border border-hair text-mw-red text-[12.5px] font-semibold px-3.5 py-1.5 disabled:opacity-60 shrink-0"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <p className="text-[11.5px] text-ink-soft mt-6 leading-[1.5] max-w-[64ch]">
          Approve records the decision. Deploying the gateway is the operator step from the runbook — an
          approve carrying the deployed addresses registers it in one signed call, after on-chain verification.
        </p>
      </div>
    </div>
  )
}

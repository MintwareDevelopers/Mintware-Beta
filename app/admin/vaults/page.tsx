'use client'

// =============================================================================
// /admin/vaults — RWA review queue (Mintware operators).
//
// Verify REGISTERED issuers → VERIFIED, and approve/reject in_review deals.
// Auth: connect an allowlisted wallet + sign a session message (buildAdminMessage);
// sent as X-Admin-* headers. In development the server dev-bypass makes it work
// without signing. Non-allowlisted wallets get a 401 → "not authorized" state.
// =============================================================================

import { useAccount, useSignMessage } from 'wagmi'
import { useCallback, useEffect, useState } from 'react'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { buildAdminMessage } from '@/lib/web3/signedActionMessages'

const LABEL = 'font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/55'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

type Creds = { message: string; signature: string }
interface PendingIssuer { id: string; name: string; address: string; since?: string; total_raised_usd?: number }
interface PendingDoc { id: string; label: string; url: string; kind: string }
interface PendingDeal {
  id: string
  description?: string
  target_apy_pct?: number
  underlying_asset_class?: string
  price_band?: string
  settle_days?: number
  kyc_tier_required?: string
  social_vaults?: { name?: string } | null
  vault_deal_documents?: PendingDoc[]
  issuer_id?: string
}

function AdminContent() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [creds, setCreds] = useState<Creds | null>(null)
  const [issuers, setIssuers] = useState<PendingIssuer[]>([])
  const [deals, setDeals] = useState<PendingDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [unauth, setUnauth] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const authHeaders = useCallback((): Record<string, string> => (
    creds ? { 'X-Admin-Message': creds.message, 'X-Admin-Signature': creds.signature } : {}
  ), [creds])

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/admin/vaults/review', { headers: authHeaders() })
      if (res.status === 401) { setUnauth(true); setLoading(false); return }
      const d = await res.json()
      setUnauth(false)
      setIssuers(d.pendingIssuers ?? [])
      setDeals(d.pendingDeals ?? [])
    } catch { setErr('Failed to load review queue') }
    setLoading(false)
  }, [authHeaders])

  useEffect(() => { load() }, [load])

  async function signIn() {
    if (!address) return
    setErr('')
    try {
      const message = buildAdminMessage({ wallet: address, issuedAt: Date.now() })
      const signature = await signMessageAsync({ message })
      setCreds({ message, signature })
    } catch { setErr('Sign-in cancelled') }
  }

  async function act(url: string, body: object, id: string) {
    setBusy(id); setErr('')
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`) }
      await load()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Action failed') }
    setBusy(null)
  }

  const total = issuers.length + deals.length

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
      <MwNav />
      <div className="max-w-[900px] mx-auto px-7 pt-7 pb-[60px] max-[640px]:px-4">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Star className="w-4 h-4 text-atx-coral" />
              <span className={LABEL}>RWA review</span>
            </div>
            <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">Review queue</h1>
          </div>
          <div className="flex items-center gap-2">
            {!creds && (
              <button onClick={signIn} className="px-4 py-2 border border-atx-ink bg-atx-panel text-atx-ink font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em]">
                Sign in as admin
              </button>
            )}
            <button onClick={load} className="px-4 py-2 border border-atx-ink bg-atx-blue text-white font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em]">
              Refresh
            </button>
          </div>
        </div>

        {err && <div className="mb-4 text-[12px] text-atx-clay bg-atx-panel border border-atx-clay/40 px-3.5 py-2.5 font-atx-display">{err}</div>}

        {unauth ? (
          <div className="border border-atx-ink/25 border-l-[3px] border-l-atx-clay bg-atx-panel px-4 py-4 flex items-start gap-2.5">
            <Star className="w-4 h-4 shrink-0 mt-0.5 text-atx-clay" />
            <div className="text-[13px] text-atx-ink/70 leading-[1.55]">
              This wallet isn&apos;t an authorized admin. Connect an allowlisted wallet and click
              <strong> Sign in as admin</strong>. (Set <code className="font-atx-mono">ADMIN_WALLETS</code> in the environment.)
            </div>
          </div>
        ) : loading ? (
          <div className="h-40 border border-atx-ink/20 bg-atx-panel animate-pulse" />
        ) : total === 0 ? (
          <div className="text-center py-16 text-atx-ink/55 font-atx-display text-[14px]">
            <div className="flex justify-center mb-3"><span className="w-3 h-3 bg-atx-acid border border-atx-ink inline-block" /></div>
            Nothing pending review. All caught up.
          </div>
        ) : (
          <div className="flex flex-col gap-9">
            {/* Pending issuers */}
            {issuers.length > 0 && (
              <div>
                <div className={`${LABEL} mb-3`}>Pending issuers · {issuers.length}</div>
                <div className="flex flex-col gap-3">
                  {issuers.map((iss) => (
                    <div key={iss.id} className="border border-atx-ink bg-atx-panel p-4 flex items-center justify-between gap-4 max-[560px]:flex-col max-[560px]:items-stretch">
                      <div className="min-w-0">
                        <div className="text-[16px] font-bold">{iss.name}</div>
                        <div className="font-atx-mono text-[11px] text-atx-ink/50 mt-0.5">{iss.id} · {iss.address}</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button disabled={busy === iss.id} onClick={() => act(`/api/admin/vaults/issuers/${iss.id}`, { status: 'VERIFIED' }, iss.id)}
                          className="px-3 py-2 border border-atx-ink bg-atx-mesquite text-white font-atx-mono text-[12px] font-semibold uppercase tracking-[0.04em] disabled:opacity-50">
                          Verify
                        </button>
                        <button disabled={busy === iss.id} onClick={() => act(`/api/admin/vaults/issuers/${iss.id}`, { status: 'SUSPENDED' }, iss.id)}
                          className="px-3 py-2 border border-atx-ink/30 bg-atx-bone text-atx-clay font-atx-mono text-[12px] font-semibold uppercase tracking-[0.04em] disabled:opacity-50">
                          Suspend
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending deals */}
            {deals.length > 0 && (
              <div>
                <div className={`${LABEL} mb-3`}>Pending deals · {deals.length}</div>
                <div className="flex flex-col gap-3">
                  {deals.map((d) => (
                    <div key={d.id} className="border border-atx-ink bg-atx-panel p-4">
                      <div className="flex items-start justify-between gap-4 mb-3 max-[560px]:flex-col">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-atx-mono text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 border border-atx-ink bg-atx-coral text-atx-ink">RWA</span>
                            <span className="text-[16px] font-bold">{d.social_vaults?.name ?? 'Untitled'}</span>
                          </div>
                          <div className="font-atx-mono text-[11px] text-atx-ink/50">
                            issuer {d.issuer_id} · {d.underlying_asset_class} · {d.target_apy_pct ?? '—'}% · {d.price_band} · {d.settle_days}d · KYC {d.kyc_tier_required}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button disabled={busy === d.id} onClick={() => act(`/api/admin/vaults/deals/${d.id}`, { action: 'approve' }, d.id)}
                            className="px-3 py-2 border border-atx-ink bg-atx-blue text-white font-atx-mono text-[12px] font-semibold uppercase tracking-[0.04em] disabled:opacity-50">
                            Approve
                          </button>
                          <button disabled={busy === d.id} onClick={() => act(`/api/admin/vaults/deals/${d.id}`, { action: 'reject' }, d.id)}
                            className="px-3 py-2 border border-atx-ink/30 bg-atx-bone text-atx-clay font-atx-mono text-[12px] font-semibold uppercase tracking-[0.04em] disabled:opacity-50">
                            Reject
                          </button>
                        </div>
                      </div>
                      {d.description && <p className="text-[13px] text-atx-ink/70 leading-[1.5] mb-3">{d.description}</p>}
                      {(d.vault_deal_documents?.length ?? 0) > 0 && (
                        <div className="border-t border-atx-ink/15 pt-2.5">
                          <div className={`${LABEL} mb-1.5`}>Documents · {d.vault_deal_documents!.length}</div>
                          <div className="flex flex-wrap gap-2">
                            {d.vault_deal_documents!.map((doc) => (
                              <a key={doc.id} href={doc.url} target="_blank" rel="noopener noreferrer"
                                className="font-atx-mono text-[11px] px-2 py-1 border border-atx-ink/30 bg-atx-bone hover:border-atx-ink">
                                {doc.label} ↗
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminVaultsPage() {
  return (
    <MwAuthGuard>
      <AdminContent />
    </MwAuthGuard>
  )
}

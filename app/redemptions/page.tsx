'use client'

// /redemptions — a holder's RWA redemption requests (real vault_redemptions data).
// Mirrors the async 30-day settlement flow: pending → ready → settled.

import { useAccount } from 'wagmi'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { fmtUSD } from '@/lib/web2/api'
import type { RedemptionRequest } from '@/lib/rwa/redemptions'

const LABEL = 'font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/55'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const STATUS: Record<string, { label: string; dot: string; txt: string }> = {
  pending: { label: 'Pending', dot: 'bg-atx-coral', txt: 'text-atx-clay' },
  ready:   { label: 'Ready',   dot: 'bg-atx-acid', txt: 'text-atx-mesquite' },
  settled: { label: 'Settled', dot: 'bg-atx-grey', txt: 'text-atx-ink/50' },
}

function RedemptionsContent() {
  const { address } = useAccount()
  const [rows, setRows] = useState<RedemptionRequest[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!address) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/vaults/redemptions?holder=${address}`)
      const d = await res.json()
      setRows(Array.isArray(d.redemptions) ? d.redemptions : [])
    } catch { setRows([]) }
    setLoading(false)
  }, [address])

  useEffect(() => { load() }, [load])

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
      <MwNav />
      <div className="max-w-[860px] mx-auto px-7 pt-7 pb-[60px] max-[640px]:px-4">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Star className="w-4 h-4 text-atx-coral" />
              <span className={LABEL}>RWA redemptions</span>
            </div>
            <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">Your redemptions</h1>
          </div>
          <button onClick={load} className="px-4 py-2 border border-atx-ink bg-atx-blue text-white font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em]">Refresh</button>
        </div>

        {loading ? (
          <div className="h-32 border border-atx-ink/20 bg-atx-panel animate-pulse" />
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-atx-ink/55 text-[14px]">
            <div className="flex justify-center mb-3"><Star className="w-8 h-8 text-atx-coral" /></div>
            No redemption requests yet. Request one from any <Link href="/vaults" className="text-atx-blue no-underline hover:underline">RWA deal page</Link>.
          </div>
        ) : (
          <div className="border border-atx-ink">
            <div className="grid grid-cols-[1fr_110px_110px_100px] max-[600px]:grid-cols-[1fr_90px_90px] items-center px-4 py-2.5 border-b border-atx-ink bg-atx-panel">
              <div className={LABEL}>Vault</div>
              <div className={`${LABEL} text-right`}>Amount</div>
              <div className={`${LABEL} text-right max-[600px]:hidden`}>Settles</div>
              <div className={`${LABEL} text-right`}>Status</div>
            </div>
            {rows.map((r, i) => {
              const s = STATUS[r.status] ?? STATUS.pending
              return (
                <div key={r.id} className={`grid grid-cols-[1fr_110px_110px_100px] max-[600px]:grid-cols-[1fr_90px_90px] items-center px-4 py-3.5 ${i < rows.length - 1 ? 'border-b border-atx-ink/12' : ''}`}>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold truncate">{r.vault}</div>
                    <div className="font-atx-mono text-[10px] text-atx-ink/45">{r.status === 'settled' ? 'complete' : `${r.daysRemaining}d remaining`}{r.kycVerified ? ' · KYC ✓' : ''}</div>
                  </div>
                  <div className="font-atx-mono text-[14px] font-bold text-right">{fmtUSD(r.sharesUsd)}</div>
                  <div className="font-atx-mono text-[12px] text-right text-atx-ink/60 max-[600px]:hidden">{r.settlesAt}</div>
                  <div className="flex items-center justify-end gap-1.5">
                    <span className={`w-[8px] h-[8px] border border-atx-ink inline-block ${s.dot}`} />
                    <span className={`font-atx-mono text-[11px] uppercase tracking-[0.06em] ${s.txt}`}>{s.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function RedemptionsPage() {
  return (
    <MwAuthGuard>
      <RedemptionsContent />
    </MwAuthGuard>
  )
}

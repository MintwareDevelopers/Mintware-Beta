'use client'

// Production RWA deal page — rendered by /vault/[id] when vault.surface === 'rwa'.
// Reuses the shared DealSection; fetches the approved deal for this vault.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { DealSection } from '@/components/vaults/DealSection'
import { fmtUSD } from '@/lib/web2/api'
import type { SocialVault } from '@/lib/web2/vault/types'
import type { DealMeta } from '@/lib/rwa/deal'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

// Redemption action rail — honest informational state (on-chain deposit/redeem
// is gated on the RWA vault contract being live).
function RwaActionRail({ deal }: { deal: DealMeta | null }) {
  return (
    <div className="border border-atx-ink bg-atx-bone sticky top-[74px]">
      <div className="px-[18px] py-3 border-b border-atx-ink bg-atx-ink text-white font-atx-mono text-[12px] uppercase tracking-[0.1em]">
        Invest
      </div>
      <div className="p-[18px] flex flex-col gap-3">
        <div>
          <div className={`${LABEL} mb-1`}>Min investment</div>
          <div className="font-atx-mono text-[20px]">{deal && deal.minInvestmentUsd > 0 ? fmtUSD(deal.minInvestmentUsd) : '—'}</div>
        </div>
        <p className="font-atx-mono text-[11px] text-atx-ink/55 leading-[1.55]">
          Deposit mints vRWA 1:1 with your shares — a bearer instrument you can trade freely.
          KYC ({deal?.kycTierRequired ?? 'BASIC'}) is required only to redeem the underlying.
        </p>
        <button disabled className="w-full font-semibold text-[14px] py-3 border border-atx-ink bg-atx-coral text-atx-ink uppercase tracking-[0.04em] disabled:opacity-45">
          Deposit
        </button>
        <p className="font-atx-mono text-[11px] text-atx-ink/45 leading-[1.5]">
          Request burns your vRWA claim ticket and starts a {deal?.settleDays ?? 30}-day settlement
          window; the issuer settles after a KYC check.
        </p>
        <button disabled className="w-full font-semibold text-[13px] py-2.5 border border-atx-ink/30 bg-atx-panel text-atx-ink/60 uppercase tracking-[0.04em] disabled:opacity-60">
          Request Redeem
        </button>
        <div className="border-t border-atx-ink/20 pt-3 font-atx-mono text-[10px] text-atx-ink/40 leading-[1.5]">
          On-chain deposits open once the vault is live on-chain. Deal terms are enforced by the
          SPV wrapper + oracle price bands.
        </div>
      </div>
    </div>
  )
}

export function RwaVaultDetailView({ vault }: { vault: SocialVault }) {
  const [deal, setDeal] = useState<DealMeta | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/vaults/${vault.id}/deal`)
      .then((r) => r.json())
      .then((d) => { if (alive) { setDeal(d.deal ?? null); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [vault.id])

  const stats: [string, string][] = [
    ['Total TVL', fmtUSD(vault.tvl_usdc ?? 0)],
    ['Target APY', deal?.targetApyPct != null ? `${deal.targetApyPct}%` : '—'],
    ['Settlement', deal ? `${deal.settleDays}d` : '—'],
    ['Price band', deal?.priceBand ?? '—'],
  ]

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
      <MwNav />
      <div className="max-w-[960px] mx-auto px-7 pt-7 pb-[60px] max-[800px]:px-4 max-[800px]:pt-5">
        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-2">
          <Link href="/vaults" className="text-[13px] text-atx-ink/55 no-underline hover:text-atx-ink">← Vaults</Link>
          <span className="text-atx-ink/30">/</span>
          <span className="text-[13px] text-atx-ink font-semibold">{vault.name}</span>
        </div>

        {/* Header */}
        <div className="border border-atx-ink bg-atx-panel p-6 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-atx-mono text-[11px] uppercase tracking-[0.08em] px-2 py-1 border border-atx-ink bg-atx-coral text-atx-ink">RWA</span>
            {vault.provider && <span className="font-atx-mono text-[12px] text-atx-ink/55">issuer · {vault.provider}</span>}
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em] leading-[1.1]">{vault.name}</h1>
          <div className="grid grid-cols-4 max-[620px]:grid-cols-2 border border-atx-ink mt-5">
            {stats.map(([k, v], i) => (
              <div key={k} className={`px-4 py-3 ${i < 3 ? 'border-r border-atx-ink/20' : ''} max-[620px]:[&:nth-child(2)]:border-r-0 ${i < 2 ? 'max-[620px]:border-b max-[620px]:border-atx-ink/20' : ''}`}>
                <div className={`${LABEL} text-[9px] mb-1`}>{k}</div>
                <div className="font-atx-mono text-[15px] font-bold">{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Body: deal + action rail */}
        <div className="grid grid-cols-[1fr_340px] gap-6 items-start max-[820px]:grid-cols-1">
          <div className="min-w-0">
            {!loaded ? (
              <div className="h-40 border border-atx-ink/20 bg-atx-panel animate-pulse" />
            ) : deal ? (
              <DealSection deal={deal} />
            ) : (
              <div className="border border-atx-ink/25 border-l-[3px] border-l-atx-clay bg-atx-panel px-4 py-3.5 flex items-start gap-2.5">
                <Star className="w-4 h-4 shrink-0 mt-0.5 text-atx-clay" />
                <div className="text-[12px] text-atx-ink/70 leading-[1.55]">
                  This deal&apos;s page is still in Mintware review. Full deal details publish once approved.
                </div>
              </div>
            )}
          </div>
          <RwaActionRail deal={deal} />
        </div>
      </div>
    </div>
  )
}

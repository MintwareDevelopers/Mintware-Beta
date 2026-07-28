'use client'

// SeedPanel — the public "Seed this vault" surface for a fair-launch raise.
// Reads /api/vaults/seed?vault_id=; self-hides if the vault has no seed. The
// escrow runs on-chain in MintwareSeedPool — contribution unlocks once the pool
// is deployed (contract_address set). ATX Settlemint.

import { useEffect, useState } from 'react'

const LABEL = 'font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/55'

interface Seed {
  quote_token: string
  token_reserve: number
  team_quote: number
  public_quote_target: number
  quote_target: number
  quote_raised: number
  threshold: number
  deploy_threshold_bps: number
  raise_deadline: string
  phase: string
  contract_address: string | null
}
interface SeedData {
  seed: Seed | null
  contributions: { contributor: string }[]
  fillPct: number
  thresholdPct: number
  thresholdMet: boolean
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

const PHASE: Record<string, { label: string; dot: string; txt: string }> = {
  seeding:   { label: 'Seeding', dot: 'bg-atx-coral', txt: 'text-atx-clay' },
  live:      { label: 'Live · growing', dot: 'bg-atx-acid', txt: 'text-atx-mesquite' },
  grown:     { label: 'Fully seeded', dot: 'bg-atx-blue', txt: 'text-atx-blue' },
  refunding: { label: 'Refunding', dot: 'bg-atx-grey', txt: 'text-atx-ink/50' },
}

export function SeedPanel({ vaultId }: { vaultId: string }) {
  const [d, setD] = useState<SeedData | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/vaults/seed?vault_id=${vaultId}`)
      .then((r) => r.json())
      .then((data: SeedData) => { if (alive) { setD(data); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [vaultId])

  if (!loaded || !d?.seed) return null // no seed → render nothing

  const s = d.seed
  const p = PHASE[s.phase] ?? PHASE.seeding
  const publicRaised = Math.max(0, s.quote_raised - s.team_quote)
  const deployed = s.contract_address != null

  return (
    <div className="border border-atx-ink bg-atx-panel [&_*]:rounded-none">
      <div className="flex items-center justify-between px-[18px] py-3 border-b border-atx-ink bg-atx-ink text-white">
        <span className="font-atx-mono text-[12px] uppercase tracking-[0.1em]">Fair-launch seed</span>
        <span className="flex items-center gap-1.5">
          <span className={`w-[8px] h-[8px] border border-white/40 inline-block ${p.dot}`} />
          <span className="font-atx-mono text-[11px] uppercase tracking-[0.06em] text-white/80">{p.label}</span>
        </span>
      </div>

      <div className="p-[18px] flex flex-col gap-4">
        {/* Fill bar with threshold marker */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className={LABEL}>Raised</span>
            <span className="font-atx-mono text-[13px]">
              <span className="font-bold text-atx-ink">${fmt(s.quote_raised)}</span>
              <span className="text-atx-ink/45"> / ${fmt(s.quote_target)}</span>
            </span>
          </div>
          <div className="relative h-[14px] border border-atx-ink bg-atx-bone overflow-hidden">
            <div className="h-full bg-atx-blue transition-[width] duration-300" style={{ width: `${d.fillPct}%` }} />
            {/* threshold marker */}
            <div className="absolute top-0 bottom-0 w-[2px] bg-atx-ink" style={{ left: `${d.thresholdPct}%` }} title="Deploy threshold" />
          </div>
          <div className="flex justify-between mt-1 font-atx-mono text-[10px] text-atx-ink/45">
            <span>{d.fillPct.toFixed(0)}% filled</span>
            <span>threshold {(s.deploy_threshold_bps / 100).toFixed(0)}%{d.thresholdMet ? ' · met ✓' : ''}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={LABEL}>Public raised</div>
            <div className="font-atx-mono text-[15px] font-bold">${fmt(publicRaised)}</div>
            <div className="font-atx-mono text-[10px] text-atx-ink/45">of ${fmt(s.public_quote_target)} public</div>
          </div>
          <div>
            <div className={LABEL}>Closes in</div>
            <div className="font-atx-mono text-[15px] font-bold">{daysLeft(s.raise_deadline)}d</div>
            <div className="font-atx-mono text-[10px] text-atx-ink/45">{d.contributions.length} contributors</div>
          </div>
        </div>

        <p className="font-atx-mono text-[11px] text-atx-ink/55 leading-[1.55] border-t border-atx-ink/15 pt-3">
          The team escrows ${fmt(s.token_reserve)} of the project token; the public co-seeds the quote
          side. At the threshold the pool deploys balanced, then grows proportionally as more seed
          arrives — price holds, depth climbs.
        </p>

        <button
          disabled={!deployed || s.phase === 'grown' || s.phase === 'refunding'}
          className="w-full font-semibold text-[14px] py-3 border border-atx-ink bg-atx-coral text-atx-ink uppercase tracking-[0.04em] disabled:opacity-45 disabled:cursor-not-allowed"
        >
          {s.phase === 'grown' ? 'Fully seeded' : deployed ? 'Seed this vault' : 'Seeding opens at deploy'}
        </button>
        {!deployed && (
          <p className="font-atx-mono text-[10px] text-atx-ink/40 leading-[1.5] text-center">
            Escrow runs on-chain via MintwareSeedPool — contribution unlocks once the pool is deployed.
          </p>
        )}
      </div>
    </div>
  )
}

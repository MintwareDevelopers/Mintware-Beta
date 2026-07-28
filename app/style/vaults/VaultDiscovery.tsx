'use client'

import { useState } from 'react'
import {
  type VaultSummary,
  type VaultSurface,
  fmtUsd,
  summarize,
} from '@/lib/vaults/discovery'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const LINE = 'border-atx-ink/20'
const TABS: Array<'All' | VaultSurface> = ['All', 'DeFi', 'RWA']

function StatusDot({ status }: { status: VaultSummary['status'] }) {
  const color =
    status === 'active' ? 'bg-atx-acid' : status === 'seeding' ? 'bg-atx-coral' : 'bg-atx-grey'
  return (
    <span className="font-atx-mono text-[11px] uppercase tracking-[0.08em] flex items-center gap-1.5">
      <span className={`w-[9px] h-[9px] border border-atx-ink inline-block ${color}`} />
      {status}
    </span>
  )
}

function VaultCard({ v }: { v: VaultSummary }) {
  const isDeFi = v.surface === 'DeFi'
  const accent = isDeFi ? 'text-atx-blue' : 'text-atx-coral'
  return (
    <div className="border border-atx-ink bg-atx-bone flex flex-col">
      <div className="p-[16px_18px] flex items-start justify-between gap-3">
        <div>
          <p className="text-[19px] font-bold tracking-tight m-0">{v.name}</p>
          <p className="text-atx-ink/55 text-[13px] mt-0.5 font-atx-mono">
            {v.surface} · {v.pair} · {v.descriptor}
          </p>
        </div>
        <Star className={`w-5 h-5 ${accent}`} />
      </div>

      <div className={`grid grid-cols-3 border-t ${LINE}`}>
        <div className={`px-[18px] py-3.5 border-r ${LINE}`}>
          <div className={LABEL}>TVL</div>
          <div className="font-atx-mono text-[20px] tabular-nums">{fmtUsd(v.tvlUsd)}</div>
        </div>
        <div className={`px-[18px] py-3.5 border-r ${LINE}`}>
          <div className={LABEL}>Net APY</div>
          <div className={`font-atx-mono text-[20px] tabular-nums ${accent}`}>
            {v.netApyPct.toFixed(1)}%
          </div>
        </div>
        <div className="px-[18px] py-3.5">
          <div className={LABEL}>Epoch</div>
          <div className="font-atx-mono text-[20px]">{v.epochLabel}</div>
        </div>
      </div>

      {isDeFi ? (
        <div className={`p-[14px_18px] border-t ${LINE}`}>
          <div className={`${LABEL} mb-2`}>Swap fee · {v.feeSplit.join(' / ')} · LP / ref / protocol / bonus</div>
          <div className="flex h-7 border border-atx-ink font-atx-mono text-[10px]">
            <span className="flex items-center justify-center bg-atx-blue text-white border-r border-atx-ink overflow-hidden" style={{ flex: v.feeSplit[0] }}>
              LPS
            </span>
            <span className="flex items-center justify-center bg-atx-coral text-atx-ink border-r border-atx-ink overflow-hidden" style={{ flex: v.feeSplit[1] }}>
              REF
            </span>
            <span className="flex items-center justify-center bg-atx-mesquite text-white border-r border-atx-ink overflow-hidden" style={{ flex: v.feeSplit[2] }}>
              PROT
            </span>
            <span className="flex items-center justify-center bg-atx-acid text-atx-ink overflow-hidden" style={{ flex: v.feeSplit[3] }}>
              BONUS
            </span>
          </div>
        </div>
      ) : (
        <div className={`p-[14px_18px] border-t ${LINE} flex gap-[22px] flex-wrap`}>
          <div>
            <div className={LABEL}>Underlying</div>
            <div className="font-atx-mono text-[15px]">{v.underlyingApyPct?.toFixed(1)}%</div>
          </div>
          <div>
            <div className={LABEL}>Band</div>
            <div className="font-atx-mono text-[15px]">{v.priceBand}</div>
          </div>
          <div>
            <div className={LABEL}>Settle</div>
            <div className="font-atx-mono text-[15px]">{v.settleDays}d</div>
          </div>
        </div>
      )}

      <div className={`mt-auto p-[14px_18px] border-t ${LINE} flex items-center justify-between gap-3`}>
        {isDeFi ? (
          <span className="font-atx-mono text-[11px] uppercase tracking-[0.07em] px-2 py-1 border border-atx-blue bg-atx-blue text-white">
            {v.profile} {v.profileRange}
          </span>
        ) : (
          <span className="font-atx-mono text-[11px] uppercase tracking-[0.07em] px-2 py-1 border border-atx-ink bg-atx-coral text-atx-ink">
            KYC AT REDEEM
          </span>
        )}
        <button
          className={`font-semibold text-[14px] px-4 py-2.5 border uppercase tracking-[0.04em] ${
            isDeFi ? 'border-atx-blue bg-atx-blue text-white' : 'border-atx-ink bg-atx-coral text-atx-ink'
          }`}
        >
          {isDeFi ? 'Deposit' : 'View'}
        </button>
      </div>
    </div>
  )
}

export function VaultDiscovery({ vaults }: { vaults: VaultSummary[] }) {
  const [filter, setFilter] = useState<'All' | VaultSurface>('All')
  const shown = filter === 'All' ? vaults : vaults.filter((v) => v.surface === filter)
  const agg = summarize(vaults)

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* Top bar */}
      <div className="flex items-center gap-3.5 px-7 h-[58px] border-b border-atx-ink/20 sticky top-0 bg-atx-bone z-10">
        <Star className="w-[18px] h-[18px] text-atx-blue" />
        <span className="font-bold">Vaults</span>
        <button className="ml-auto font-atx-mono text-[12px] text-atx-ink/55 border border-atx-ink/20 px-2.5 py-1.5">
          Search ⌘K
        </button>
        <button className="font-semibold text-[13px] font-atx-mono px-3 py-1.5 border border-atx-blue bg-atx-blue text-white uppercase tracking-[0.04em]">
          Connect Wallet
        </button>
      </div>

      {/* Header */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="px-7 pt-8 pb-7">
          <h1 className="font-bold tracking-[-0.03em] leading-[0.85] text-[clamp(44px,8vw,92px)]">
            VAULT<span className="text-atx-grey">S</span>
          </h1>
          <p className="text-atx-ink/55 text-[15px] max-w-[62ch] mt-4">
            Deposit once — the vault handles MEV protection, range optimization, idle-capital routing,
            and attribution-boosted fee share. Two surfaces on one ERC-4626 base.
          </p>
        </div>
        {/* Title-block */}
        <div className="border-t border-atx-ink grid [grid-template-columns:1.4fr_1fr_1fr_1fr] max-[720px]:[grid-template-columns:1fr_1fr]">
          <div className="px-7 py-3 border-r border-atx-ink/20">
            <div className={`${LABEL} text-[9px] mb-1.5`}>Total TVL</div>
            <div className="font-bold text-[15px] tabular-nums">{fmtUsd(agg.tvlUsd)}</div>
          </div>
          <div className="px-7 py-3 border-r border-atx-ink/20">
            <div className={`${LABEL} text-[9px] mb-1.5`}>Vaults</div>
            <div className="font-bold text-[15px]">{String(agg.count).padStart(3, '0')}</div>
          </div>
          <div className="px-7 py-3 border-r border-atx-ink/20">
            <div className={`${LABEL} text-[9px] mb-1.5`}>Surfaces</div>
            <div className="font-bold text-[15px]">DeFi · RWA</div>
          </div>
          <div className="px-7 py-3">
            <div className={`${LABEL} text-[9px] mb-1.5`}>Registry</div>
            <div className="font-bold text-[15px] text-atx-blue">OPEN</div>
          </div>
        </div>
      </section>

      {/* Filters */}
      <div className="px-7 pt-8 flex items-center gap-3.5">
        <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">
          {String(shown.length).padStart(2, '0')}
        </span>
        <div className="flex border border-atx-ink">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`font-atx-mono text-[12px] uppercase tracking-[0.1em] px-4 py-2 border-r border-atx-ink last:border-r-0 ${
                filter === t ? 'bg-atx-ink text-atx-bone' : 'bg-transparent text-atx-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-4">
          <StatusDot status="active" />
          <StatusDot status="seeding" />
        </span>
      </div>

      {/* Grid */}
      <div className="px-7 py-7 grid grid-cols-2 gap-[22px] max-[860px]:grid-cols-1">
        {shown.map((v) => (
          <VaultCard key={v.id} v={v} />
        ))}
      </div>
    </div>
  )
}

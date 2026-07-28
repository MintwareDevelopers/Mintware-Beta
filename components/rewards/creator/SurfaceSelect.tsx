'use client'

// =============================================================================
// SurfaceSelect.tsx — RWA Incentive Layer · R1
//
// Campaign surface picker at the top of Step 2. DeFi (default) points the
// campaign at a DeFi pool; RWA links it to an approved deal, which seeds the
// duration-match default from the deal's settle_days.
//
// Permissionless by design — this only associates a campaign with a deal for
// discovery + duration-match. It is NOT a gate; eligibility lives in the token.
// =============================================================================

import { useEffect, useState } from 'react'
import type { CreatorFormState } from '@/lib/rewards/creator'

interface Deal {
  dealId: string
  vaultId: string
  name: string
  asset: string
  apyPct: number | null
  settleDays: number
  status: string
}

interface SurfaceSelectProps {
  form:     CreatorFormState
  onChange: (partial: Partial<CreatorFormState>) => void
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-atx-mono text-[10px] font-semibold tracking-[0.1em] uppercase text-atx-ink/55 mb-[10px]">
      {children}
    </div>
  )
}

export function SurfaceSelect({ form, onChange }: SurfaceSelectProps) {
  const [deals, setDeals]     = useState<Deal[]>([])
  const [loading, setLoading] = useState(false)
  const isRwa = form.surface === 'rwa'

  useEffect(() => {
    if (!isRwa || deals.length > 0) return
    setLoading(true)
    fetch('/api/vaults/deals')
      .then((r) => r.json())
      .then((d) => setDeals(Array.isArray(d.deals) ? d.deals : []))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false))
  }, [isRwa, deals.length])

  function pickDefi() {
    onChange({ surface: 'defi', linkedDealId: null, durationMatchDays: undefined })
  }
  function pickRwa() {
    onChange({ surface: 'rwa' })
  }
  function pickDeal(dealId: string) {
    const deal = deals.find((d) => d.dealId === dealId)
    onChange({
      surface: 'rwa',
      linkedDealId: dealId || null,
      durationMatchDays: deal ? deal.settleDays : undefined,
    })
  }

  const selectedDeal = deals.find((d) => d.dealId === form.linkedDealId)

  return (
    <div>
      <SectionLabel>Surface</SectionLabel>

      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={pickDefi}
          className={`font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em] py-[9px] px-5 cursor-pointer border flex-1 transition-colors duration-150${!isRwa ? ' bg-atx-blue border-atx-ink text-white' : ' bg-atx-panel border-atx-ink/30 text-atx-ink/60 hover:border-atx-ink hover:text-atx-ink'}`}
        >
          DeFi pool
        </button>
        <button
          type="button"
          onClick={pickRwa}
          className={`font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em] py-[9px] px-5 cursor-pointer border flex-1 transition-colors duration-150${isRwa ? ' bg-atx-coral border-atx-ink text-white' : ' bg-atx-panel border-atx-ink/30 text-atx-ink/60 hover:border-atx-ink hover:text-atx-ink'}`}
        >
          RWA deal
        </button>
      </div>

      {isRwa && (
        <div className="flex flex-col gap-2">
          <select
            value={form.linkedDealId ?? ''}
            onChange={(e) => pickDeal(e.target.value)}
            className="font-atx-mono text-[13px] text-atx-ink bg-atx-panel border border-atx-ink/30 px-3 py-[10px] cursor-pointer focus:border-atx-blue focus:outline-none"
          >
            <option value="">{loading ? 'Loading deals…' : 'Select an approved deal…'}</option>
            {deals.map((d) => (
              <option key={d.dealId} value={d.dealId}>
                {d.name} · {d.asset}{d.apyPct != null ? ` · ${d.apyPct}% APY` : ''}
              </option>
            ))}
          </select>

          {!loading && deals.length === 0 && (
            <div className="font-atx-mono text-[11px] text-atx-ink/50">
              No approved deals yet — approve one in /admin/vaults first.
            </div>
          )}

          {selectedDeal && (
            <div className="font-atx-mono text-[11px] text-atx-ink/60 border-l-2 border-atx-coral pl-[10px]">
              Duration-match set from settlement: lock ≥ {selectedDeal.settleDays}d earns the bonus.
              Rewards stay permissionless — eligibility lives in the wrapped token.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

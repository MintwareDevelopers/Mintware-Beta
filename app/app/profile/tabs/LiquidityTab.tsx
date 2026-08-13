'use client'

import { useEffect, useState } from 'react'

interface LpDeposit {
  id: string
  vault_id: string
  usdc_amount: number
  lock_tier: string
  deposited_at: string
  status: string
  locked_until: string | null
  compounded_amount: number
  vault?: { id: string; name: string; project_token: string; status: string; tvl_usdc: number }
}

interface LpQueueItem {
  id: string
  vault_id: string
  requested_amount: number
  executable_at: string
  penalty_pct: number
  status: string
}

interface Props {
  wallet: string
}

export function LiquidityTab({ wallet }: Props) {
  const [lpDeposits, setLpDeposits] = useState<LpDeposit[]>([])
  const [lpQueue, setLpQueue]       = useState<LpQueueItem[]>([])
  const [lpLoading, setLpLoading]   = useState(false)

  useEffect(() => {
    if (!wallet) return
    setLpLoading(true)
    fetch(`/api/vault?address=${wallet}`)
      .then(r => r.json())
      .then(d => {
        setLpDeposits(d.deposits ?? [])
        setLpQueue(d.withdrawal_queue ?? [])
      })
      .catch(() => {})
      .finally(() => setLpLoading(false))
  }, [wallet])

  const tierColors: Record<string, string> = {
    flex:      'var(--color-ink-soft)',
    committed: 'var(--color-peri)',
    aligned:   'var(--color-peri-deep)',
    core:      'var(--color-coral2)',
  }

  const tierMultipliers: Record<string, string> = {
    flex: '1.0×', committed: '1.15×', aligned: '1.3×', core: '1.5×',
  }

  if (lpLoading) {
    return <div className="text-center py-12 text-ink-mid text-[13px]">Loading positions…</div>
  }

  if (lpDeposits.length === 0 && lpQueue.length === 0) {
    return (
      <div className="text-center py-12 text-ink-mid text-[13px]">
        No active LP positions.{' '}
        {process.env.NEXT_PUBLIC_VAULTS_LOCKED !== 'true' ? (
          <a href="/app/vaults" className="text-peri-deep font-semibold no-underline uppercase tracking-[0.06em]">Browse vaults →</a>
        ) : (
          <span className="text-ink-soft font-semibold">Vaults coming soon</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Summary row */}
      <div className="flex gap-4 mb-1 flex-wrap">
        {[
          {
            label: 'Total deposited',
            value: `$${lpDeposits.reduce((s, d) => s + d.usdc_amount, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
          },
          {
            label: 'Active positions',
            value: String(lpDeposits.filter(d => d.status === 'active').length),
          },
          {
            label: 'Compounded',
            value: `$${lpDeposits.reduce((s, d) => s + (d.compounded_amount ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
          },
        ].map(({ label, value }) => (
          <div key={label} className="soft-card flex-1 min-w-[120px] px-4 py-3">
            <div className="text-[20px] font-atx-display font-medium text-peri-deep tracking-[-0.5px] tabular-nums">{value}</div>
            <div className="text-[11px] text-ink-soft uppercase tracking-[0.08em] font-semibold mt-[2px]">{label}</div>
          </div>
        ))}
      </div>

      {/* Deposit rows */}
      {lpDeposits.map(d => {
        const color   = tierColors[d.lock_tier] ?? 'var(--color-ink-soft)'
        const daysLeft = d.locked_until
          ? Math.max(0, Math.ceil((new Date(d.locked_until).getTime() - Date.now()) / 86_400_000))
          : 0
        return (
          <a
            key={d.id}
            href={`/app/vault/${d.vault?.id ?? d.vault_id}`}
            className="soft-card no-underline flex items-center justify-between gap-3 px-[18px] py-3.5 cursor-pointer hover:border-[rgba(108,108,240,0.35)] transition-colors"
          >
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-ground-cool border border-hair grid place-items-center shrink-0 font-atx-display font-medium text-[13px] text-ink">
                {(d.vault?.name ?? 'V').charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-ink font-atx-display truncate">
                  {d.vault?.name ?? 'Vault'}
                </div>
                <div className="text-[11px] text-ink-soft mt-[1px]">
                  {d.lock_tier.charAt(0).toUpperCase() + d.lock_tier.slice(1)}
                  {daysLeft > 0 ? ` · ${daysLeft}d remaining` : ''}
                  {d.status === 'withdrawal_pending' ? ' · Withdrawing' : ''}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[16px] font-atx-display font-medium text-peri-deep tabular-nums">
                ${d.usdc_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="text-[11px] font-semibold tabular-nums" style={{ color }}>
                {tierMultipliers[d.lock_tier] ?? '1.0×'}
              </div>
            </div>
          </a>
        )
      })}

      {/* Pending withdrawals */}
      {lpQueue.length > 0 && (
        <div className="mt-2">
          <div className="uppercase tracking-[0.1em] text-[10px] font-semibold text-ink-soft mb-2">Pending withdrawals</div>
          {lpQueue.map(q => {
            const daysLeft = Math.max(0, Math.ceil((new Date(q.executable_at).getTime() - Date.now()) / 86_400_000))
            return (
              <div key={q.id} className="soft-card flex items-center justify-between px-4 py-3 mb-2">
                <div>
                  <div className="text-[14px] font-atx-display font-medium text-ink tabular-nums">
                    ${q.requested_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-[11px] text-ink-soft mt-0.5">
                    Executable {daysLeft === 0 ? 'today' : `in ${daysLeft}d`}
                    {q.penalty_pct > 0 ? ` · ${q.penalty_pct}% penalty` : ''}
                  </div>
                </div>
                <span className="rounded-full border border-[rgba(209,67,67,0.35)] text-[#D14343] px-2 py-[2px] text-[10px] uppercase tracking-[0.08em] font-semibold">Pending</span>
              </div>
            )
          })}
        </div>
      )}

      {process.env.NEXT_PUBLIC_VAULTS_LOCKED !== 'true' ? (
        <a href="/app/vaults" className="text-[13px] text-peri-deep font-semibold no-underline text-center block mt-2 uppercase tracking-[0.06em]">
          Browse more vaults →
        </a>
      ) : (
        <div className="text-[13px] text-ink-soft font-semibold text-center block mt-2 uppercase tracking-[0.06em]">
          Vaults coming soon
        </div>
      )}
    </div>
  )
}

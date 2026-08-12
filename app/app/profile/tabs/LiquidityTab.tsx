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
    flex:      'var(--color-atx-grey)',
    committed: 'var(--color-atx-blue)',
    aligned:   'var(--color-atx-mesquite)',
    core:      'var(--color-atx-clay)',
  }

  const tierMultipliers: Record<string, string> = {
    flex: '1.0×', committed: '1.15×', aligned: '1.3×', core: '1.5×',
  }

  if (lpLoading) {
    return <div className="text-center py-12 text-atx-ink/60 text-[13px]">Loading positions…</div>
  }

  if (lpDeposits.length === 0 && lpQueue.length === 0) {
    return (
      <div className="text-center py-12 text-atx-ink/60 text-[13px]">
        No active LP positions.{' '}
        {process.env.NEXT_PUBLIC_VAULTS_LOCKED !== 'true' ? (
          <a href="/app/vaults" className="text-atx-blue font-semibold no-underline font-atx-mono uppercase tracking-[0.06em]">Browse vaults →</a>
        ) : (
          <span className="text-atx-ink/55 font-semibold">Vaults coming soon</span>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Summary row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 4, flexWrap: 'wrap' }}>
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
          <div key={label} className="bg-atx-panel border border-atx-ink/25" style={{ flex: 1, minWidth: 120, padding: '12px 16px' }}>
            <div className="text-[20px] font-bold font-atx-mono text-atx-blue tracking-[-0.5px]">{value}</div>
            <div className="text-[11px] text-atx-ink/55 uppercase tracking-[0.08em] font-semibold mt-[2px] font-atx-mono">{label}</div>
          </div>
        ))}
      </div>

      {/* Deposit rows */}
      {lpDeposits.map(d => {
        const color   = tierColors[d.lock_tier] ?? 'var(--color-atx-grey)'
        const daysLeft = d.locked_until
          ? Math.max(0, Math.ceil((new Date(d.locked_until).getTime() - Date.now()) / 86_400_000))
          : 0
        return (
          <a
            key={d.id}
            href={`/app/vault/${d.vault?.id ?? d.vault_id}`}
            className="bg-atx-panel border border-atx-ink/25 no-underline transition-shadow duration-150 hover:shadow-[4px_4px_0_0_rgba(17,17,17,0.12)]"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', cursor: 'pointer', textDecoration: 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <div style={{ width: 36, height: 36, background: 'var(--color-atx-bone)', border: '1px solid var(--color-atx-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg viewBox="0 0 100 100" style={{ width: 16, height: 16, color: 'var(--color-atx-coral)' }} aria-hidden="true"><path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"/></svg>
              </div>
              <div>
                <div className="text-[14px] font-semibold text-atx-ink font-atx-display">
                  {d.vault?.name ?? 'Vault'}
                </div>
                <div className="text-[11px] text-atx-ink/55 font-atx-mono" style={{ marginTop: 1 }}>
                  {d.lock_tier.charAt(0).toUpperCase() + d.lock_tier.slice(1)}
                  {daysLeft > 0 ? ` · ${daysLeft}d remaining` : ''}
                  {d.status === 'withdrawal_pending' ? ' · Withdrawing' : ''}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="text-[16px] font-bold font-atx-mono" style={{ color: 'var(--color-atx-blue)' }}>
                ${d.usdc_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="text-[11px] font-semibold font-atx-mono" style={{ color }}>
                {tierMultipliers[d.lock_tier] ?? '1.0×'}
              </div>
            </div>
          </a>
        )
      })}

      {/* Pending withdrawals */}
      {lpQueue.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-atx-ink/55" style={{ marginBottom: 8 }}>Pending withdrawals</div>
          {lpQueue.map(q => {
            const daysLeft = Math.max(0, Math.ceil((new Date(q.executable_at).getTime() - Date.now()) / 86_400_000))
            return (
              <div
                key={q.id}
                className="bg-atx-panel border border-atx-ink/25"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}
              >
                <div>
                  <div className="text-[14px] font-bold font-atx-mono text-atx-ink">
                    ${q.requested_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-[11px] text-atx-ink/55 font-atx-mono" style={{ marginTop: 2 }}>
                    Executable {daysLeft === 0 ? 'today' : `in ${daysLeft}d`}
                    {q.penalty_pct > 0 ? ` · ${q.penalty_pct}% penalty` : ''}
                  </div>
                </div>
                <span className="border border-atx-ink/40 text-atx-clay px-[7px] py-[2px] text-[10px] uppercase tracking-[0.08em] font-medium font-atx-mono">Pending</span>
              </div>
            )
          })}
        </div>
      )}

      {process.env.NEXT_PUBLIC_VAULTS_LOCKED !== 'true' ? (
        <a
          href="/app/vaults"
          className="text-[13px] text-atx-blue font-semibold no-underline text-center block mt-2 font-atx-mono uppercase tracking-[0.06em]"
        >
          Browse more vaults →
        </a>
      ) : (
        <div className="text-[13px] text-atx-ink/55 font-semibold text-center block mt-2 font-atx-mono uppercase tracking-[0.06em]">
          Vaults coming soon
        </div>
      )}
    </div>
  )
}

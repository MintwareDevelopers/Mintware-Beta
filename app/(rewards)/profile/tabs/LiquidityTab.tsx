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
    flex:      'var(--color-mw-ink-3)',
    committed: 'var(--color-mw-brand)',
    aligned:   'var(--color-mw-teal)',
    core:      'var(--color-mw-amber)',
  }

  const tierMultipliers: Record<string, string> = {
    flex: '1.0×', committed: '1.15×', aligned: '1.3×', core: '1.5×',
  }

  if (lpLoading) {
    return <div className="text-center py-12 text-mw-ink-3 text-[13px]">Loading positions…</div>
  }

  if (lpDeposits.length === 0 && lpQueue.length === 0) {
    return (
      <div className="text-center py-12 text-mw-ink-3 text-[13px]">
        No active LP positions.{' '}
        {process.env.NEXT_PUBLIC_PHASE2_ENABLED === 'true' ? (
          <a href="/vaults" className="text-mw-brand font-semibold no-underline">Browse vaults →</a>
        ) : (
          <span className="text-mw-ink-4 font-semibold">Vaults coming soon</span>
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
          <div key={label} className="mw-card" style={{ flex: 1, minWidth: 120, padding: '12px 16px' }}>
            <div className="text-[20px] font-bold font-mono text-mw-brand tracking-[-0.5px]">{value}</div>
            <div className="text-[11px] text-mw-ink-3 uppercase tracking-[0.08em] font-semibold mt-[2px]">{label}</div>
          </div>
        ))}
      </div>

      {/* Deposit rows */}
      {lpDeposits.map(d => {
        const color   = tierColors[d.lock_tier] ?? 'var(--color-mw-ink-3)'
        const daysLeft = d.locked_until
          ? Math.max(0, Math.ceil((new Date(d.locked_until).getTime() - Date.now()) / 86_400_000))
          : 0
        return (
          <a
            key={d.id}
            href={`/vault/${d.vault?.id ?? d.vault_id}`}
            className="mw-card no-underline"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', cursor: 'pointer', textDecoration: 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--color-mw-brand-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>⬡</div>
              <div>
                <div className="text-[14px] font-semibold text-mw-ink" style={{ fontFamily: 'var(--font-jakarta)' }}>
                  {d.vault?.name ?? 'Vault'}
                </div>
                <div className="text-[11px] text-mw-ink-4" style={{ fontFamily: 'var(--font-jakarta)', marginTop: 1 }}>
                  {d.lock_tier.charAt(0).toUpperCase() + d.lock_tier.slice(1)}
                  {daysLeft > 0 ? ` · ${daysLeft}d remaining` : ''}
                  {d.status === 'withdrawal_pending' ? ' · Withdrawing' : ''}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="text-[16px] font-bold font-mono" style={{ color: 'var(--color-mw-brand)' }}>
                ${d.usdc_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="text-[11px] font-semibold" style={{ color, fontFamily: 'var(--font-jakarta)' }}>
                {tierMultipliers[d.lock_tier] ?? '1.0×'}
              </div>
            </div>
          </a>
        )
      })}

      {/* Pending withdrawals */}
      {lpQueue.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="mw-label text-mw-ink-3" style={{ marginBottom: 8 }}>Pending withdrawals</div>
          {lpQueue.map(q => {
            const daysLeft = Math.max(0, Math.ceil((new Date(q.executable_at).getTime() - Date.now()) / 86_400_000))
            return (
              <div
                key={q.id}
                className="mw-card"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}
              >
                <div>
                  <div className="text-[14px] font-bold font-mono text-mw-ink">
                    ${q.requested_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-[11px] text-mw-ink-4" style={{ fontFamily: 'var(--font-jakarta)', marginTop: 2 }}>
                    Executable {daysLeft === 0 ? 'today' : `in ${daysLeft}d`}
                    {q.penalty_pct > 0 ? ` · ${q.penalty_pct}% penalty` : ''}
                  </div>
                </div>
                <span className="mw-pill mw-pill-soon">Pending</span>
              </div>
            )
          })}
        </div>
      )}

      {process.env.NEXT_PUBLIC_PHASE2_ENABLED === 'true' ? (
        <a
          href="/vaults"
          className="text-[13px] text-mw-brand font-semibold no-underline text-center block mt-2"
          style={{ fontFamily: 'var(--font-jakarta)' }}
        >
          Browse more vaults →
        </a>
      ) : (
        <div
          className="text-[13px] text-mw-ink-4 font-semibold text-center block mt-2"
          style={{ fontFamily: 'var(--font-jakarta)' }}
        >
          Vaults coming soon
        </div>
      )}
    </div>
  )
}

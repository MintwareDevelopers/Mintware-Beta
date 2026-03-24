'use client'

import { useAccount } from 'wagmi'
import { useParams }  from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { MwNav }       from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { fmtUSD }      from '@/lib/web2/api'
import type { SocialVault, LpDeposit, WithdrawalQueueEntry, LockTier } from '@/lib/web2/vault/types'
import { LOCK_TIERS } from '@/lib/web2/vault/types'

// ─── helpers ────────────────────────────────────────────────────────────────
function shortAddr(a: string) { return `${a.slice(0, 6)}…${a.slice(-4)}` }

function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

function penaltyPct(deposit: LpDeposit): number {
  if (deposit.lock_tier === 'flex' || !deposit.locked_until) return 0
  const start      = new Date(deposit.deposited_at).getTime()
  const end        = new Date(deposit.locked_until).getTime()
  const elapsed    = (Date.now() - start) / (end - start)
  if (elapsed < 0.2) return 2.0
  if (elapsed < 0.5) return 1.0
  if (elapsed < 0.8) return 0.5
  return 0
}

// ─── Status pill ─────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:  { label: 'Active',  cls: 'mw-pill-live' },
    seeding: { label: 'Seeding', cls: 'mw-pill-soon' },
    paused:  { label: 'Paused',  cls: 'mw-pill-ended' },
    closed:  { label: 'Closed',  cls: 'mw-pill-ended' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'mw-pill-ended' }
  return <span className={`mw-pill ${cls}`}>{label}</span>
}

// ─── Lock tier selector ───────────────────────────────────────────────────────
function LockTierSelector({ value, onChange }: { value: LockTier; onChange: (t: LockTier) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
      {(Object.entries(LOCK_TIERS) as [LockTier, typeof LOCK_TIERS[LockTier]][]).map(([tier, meta]) => (
        <button
          key={tier}
          onClick={() => onChange(tier)}
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            border: `1.5px solid ${value === tier ? meta.color : 'var(--color-mw-border)'}`,
            background: value === tier ? `color-mix(in srgb, ${meta.color} 8%, white)` : 'white',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: meta.color, fontFamily: 'var(--font-jakarta)', marginBottom: 2 }}>
            {meta.label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>
            {meta.period} · {meta.multiplier} · {meta.notice} notice
          </div>
        </button>
      ))}
    </div>
  )
}

// ─── Deposit panel ────────────────────────────────────────────────────────────
function DepositPanel({ vault, onDeposited }: { vault: SocialVault; onDeposited: () => void }) {
  const { address } = useAccount()
  const [amount, setAmount]     = useState('')
  const [tier, setTier]         = useState<LockTier>('flex')
  const [submitting, setSub]    = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState(false)

  async function handleDeposit() {
    if (!address || !amount || parseFloat(amount) <= 0) return
    setSub(true); setError('')
    try {
      // TODO T3.5: call SocialVault.deposit() on-chain first, then record here
      const res = await fetch('/api/vault/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vault_id:    vault.id,
          wallet:      address,
          usdc_amount: parseFloat(amount),
          lock_tier:   tier,
          tx_hash:     '0x_pending_wire', // placeholder until T3.5 on-chain wiring
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Deposit failed')
      }
      setSuccess(true)
      setAmount('')
      onDeposited()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Deposit failed')
    } finally {
      setSub(false)
    }
  }

  if (success) return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-mw-green)', fontFamily: 'var(--font-jakarta)' }}>
        Deposit recorded
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-mw-ink-3)', marginTop: 4, fontFamily: 'var(--font-jakarta)' }}>
        Your position will appear below once confirmed on-chain.
      </div>
      <button
        onClick={() => setSuccess(false)}
        style={{ marginTop: 16, fontSize: 13, color: 'var(--color-mw-brand)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jakarta)', fontWeight: 600 }}
      >
        Deposit more →
      </button>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Amount input */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-mw-ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-jakarta)', display: 'block', marginBottom: 6 }}>
          USDC amount
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-mono)' }}>$</span>
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px 10px 24px',
              border: '1.5px solid var(--color-mw-border)',
              borderRadius: 'var(--radius-sm)', fontSize: 15,
              fontFamily: 'var(--font-mono)', color: 'var(--color-mw-ink)',
              background: 'white', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Lock tier */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-mw-ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-jakarta)', display: 'block', marginBottom: 8 }}>
          Lock tier
        </label>
        <LockTierSelector value={tier} onChange={setTier} />
      </div>

      {/* Multiplier preview */}
      <div style={{ background: 'var(--color-mw-brand-dim)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>Your fee multiplier</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-mw-brand)', fontFamily: 'var(--font-mono)' }}>
          {LOCK_TIERS[tier].multiplier}
        </span>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--color-mw-red)', fontFamily: 'var(--font-jakarta)', background: 'rgba(239,68,68,0.06)', borderRadius: 6, padding: '8px 12px' }}>
          {error}
        </div>
      )}

      <button
        onClick={handleDeposit}
        disabled={submitting || !amount || parseFloat(amount) <= 0 || vault.status === 'closed'}
        style={{
          padding: '12px', borderRadius: 'var(--radius-sm)',
          background: 'var(--color-mw-brand)', color: 'white',
          fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-jakarta)',
          border: 'none', cursor: 'pointer',
          opacity: (submitting || !amount || vault.status === 'closed') ? 0.5 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {submitting ? 'Depositing…' : 'Deposit USDC'}
      </button>
      <p style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta)', textAlign: 'center', margin: 0 }}>
        7-day notice period required for all withdrawals
      </p>
    </div>
  )
}

// ─── Position row ─────────────────────────────────────────────────────────────
function PositionRow({ deposit, onWithdraw }: { deposit: LpDeposit; onWithdraw: (id: string) => void }) {
  const tier    = LOCK_TIERS[deposit.lock_tier]
  const penalty = penaltyPct(deposit)
  const daysLeft = deposit.locked_until ? daysUntil(deposit.locked_until) : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--color-mw-border)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-mw-ink)' }}>
            {fmtUSD(deposit.usdc_amount)}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: tier.color, fontFamily: 'var(--font-jakarta)', background: `color-mix(in srgb, ${tier.color} 10%, white)`, padding: '2px 7px', borderRadius: 99 }}>
            {tier.label}
          </span>
          {deposit.status === 'withdrawal_pending' && (
            <span style={{ fontSize: 11, color: 'var(--color-mw-amber)', fontFamily: 'var(--font-jakarta)', fontWeight: 600 }}>
              Withdrawing
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta)' }}>
          {deposit.lock_tier !== 'flex' && daysLeft > 0
            ? `${daysLeft}d remaining · ${penalty > 0 ? `${penalty}% early exit` : 'no penalty'}`
            : 'No lock · can withdraw anytime'}
          {deposit.compounded_amount > 0 && ` · +${fmtUSD(deposit.compounded_amount)} compounded`}
        </div>
      </div>
      {deposit.status === 'active' && (
        <button
          onClick={() => onWithdraw(deposit.id)}
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-mw-ink-3)', background: 'none', border: '1px solid var(--color-mw-border)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: 'var(--font-jakarta)' }}
        >
          Withdraw
        </button>
      )}
    </div>
  )
}

// ─── Main content ─────────────────────────────────────────────────────────────
function VaultDetailContent() {
  const { address }    = useAccount()
  const { id }         = useParams<{ id: string }>()
  const wallet         = address?.toLowerCase() ?? ''

  const [vault, setVault]         = useState<SocialVault | null>(null)
  const [deposits, setDeposits]   = useState<LpDeposit[]>([])
  const [queue, setQueue]         = useState<WithdrawalQueueEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState<'deposit' | 'position' | 'epoch'>('deposit')
  const [withdrawing, setWith]    = useState<string | null>(null)
  const [withErr, setWithErr]     = useState('')

  const loadVault = useCallback(async () => {
    if (!id) return
    const [vRes, dRes] = await Promise.all([
      fetch(`/api/vault?id=${id}`).then(r => r.json()),
      wallet ? fetch(`/api/vault?address=${wallet}`).then(r => r.json()) : Promise.resolve({ deposits: [], withdrawal_queue: [] }),
    ])
    setVault(vRes?.error ? null : vRes)
    if (!vRes?.error) {
      setDeposits((dRes.deposits ?? []).filter((d: LpDeposit) => d.vault_id === id || (d as LpDeposit & { vault?: { id: string } }).vault?.id === id))
      setQueue((dRes.withdrawal_queue ?? []).filter((q: WithdrawalQueueEntry) => q.vault_id === id))
    }
    setLoading(false)
  }, [id, wallet])

  useEffect(() => { loadVault() }, [loadVault])

  async function handleWithdraw(depositId: string) {
    const dep = deposits.find(d => d.id === depositId)
    if (!dep || !address) return
    setWith(depositId); setWithErr('')
    try {
      const res = await fetch('/api/vault/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deposit_id: depositId, wallet: address, requested_amount: dep.usdc_amount }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed')
      }
      await loadVault()
      setTab('position')
    } catch (e: unknown) {
      setWithErr(e instanceof Error ? e.message : 'Withdrawal failed')
    } finally {
      setWith(null)
    }
  }

  if (loading) return (
    <div style={{ padding: '40px 28px', maxWidth: 900, margin: '0 auto' }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ height: 80, background: 'linear-gradient(90deg,var(--color-mw-border) 25%,rgba(0,0,0,0.04) 50%,var(--color-mw-border) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite', borderRadius: 12, marginBottom: 12 }} />
      ))}
    </div>
  )

  if (!vault) return (
    <div style={{ padding: '60px 28px', textAlign: 'center', color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>
      Vault not found. <Link href="/vaults" style={{ color: 'var(--color-mw-brand)' }}>← Back to vaults</Link>
    </div>
  )

  const epoch       = vault.current_epoch
  const totalDeposited = deposits.reduce((s, d) => s + d.usdc_amount, 0)

  return (
    <>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .vd-page { background: var(--color-mw-surface); min-height: 100vh; }
        .vd-inner { max-width: 960px; margin: 0 auto; padding: 28px 28px 60px; }
        @media(max-width:800px){ .vd-inner{padding:20px 16px 48px;} }
        .vd-layout { display: grid; grid-template-columns: 1fr 360px; gap: 20px; align-items: start; }
        @media(max-width:760px){ .vd-layout{grid-template-columns:1fr;} }
        .vd-card { background: white; border: 1px solid var(--color-mw-border); border-radius: var(--radius-md); padding: 24px; }
        .vd-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--color-mw-border); margin-bottom: 20px; }
        .vd-tab { padding: 10px 16px; font-size: 13px; font-weight: 600; font-family: var(--font-jakarta); color: var(--color-mw-ink-3); border: none; background: none; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color 0.15s, border-color 0.15s; }
        .vd-tab.active { color: var(--color-mw-brand); border-bottom-color: var(--color-mw-brand); }
        .vd-stat-row { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; }
        .vd-stat { display: flex; flex-direction: column; gap: 2px; }
        .vd-stat-val { font-size: 22px; font-weight: 700; font-family: var(--font-mono); color: var(--color-mw-ink); }
        .vd-stat-lbl { font-size: 11px; color: var(--color-mw-ink-3); font-family: var(--font-jakarta); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
      `}</style>

      <div className="vd-page">
        <MwNav />
        <div className="vd-inner">

          {/* ── Breadcrumb ── */}
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link href="/vaults" style={{ fontSize: 13, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)', textDecoration: 'none' }}>
              ← Vaults
            </Link>
            <span style={{ color: 'var(--color-mw-border-strong)' }}>/</span>
            <span style={{ fontSize: 13, color: 'var(--color-mw-ink)', fontFamily: 'var(--font-jakarta)', fontWeight: 600 }}>{vault.name}</span>
          </div>

          <div className="vd-layout">

            {/* ── Left: vault info + tabs ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Vault header card */}
              <div className="vd-card">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--color-mw-brand-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>⬡</div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-mw-ink)', fontFamily: 'var(--font-jakarta)', lineHeight: 1.2 }}>{vault.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {shortAddr(vault.project_token)} · chain {vault.chain_id}
                      </div>
                    </div>
                  </div>
                  <StatusPill status={vault.status} />
                </div>

                <div className="vd-stat-row">
                  <div className="vd-stat">
                    <span className="vd-stat-val" style={{ color: 'var(--color-mw-brand)' }}>{vault.tvl_usdc > 0 ? fmtUSD(vault.tvl_usdc) : '—'}</span>
                    <span className="vd-stat-lbl">TVL</span>
                  </div>
                  <div className="vd-stat">
                    <span className="vd-stat-val" style={{ color: 'var(--color-mw-green)' }}>{epoch?.total_pool ? fmtUSD(epoch.total_pool) : '—'}</span>
                    <span className="vd-stat-lbl">Epoch pool</span>
                  </div>
                  <div className="vd-stat">
                    <span className="vd-stat-val">{epoch?.epoch_number ?? '—'}</span>
                    <span className="vd-stat-lbl">Epoch</span>
                  </div>
                  {vault.tick_lower != null && (
                    <div className="vd-stat">
                      <span className="vd-stat-val" style={{ fontSize: 14 }}>
                        [{vault.tick_lower}, {vault.tick_upper}]
                      </span>
                      <span className="vd-stat-lbl">Tick range</span>
                    </div>
                  )}
                </div>

                {/* Hook address */}
                <div style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-mono)', padding: '8px 12px', background: 'var(--color-mw-surface)', borderRadius: 6 }}>
                  Hook: {shortAddr(vault.pool_key?.hooks ?? '0x0000')}
                  {vault.contract_address && ` · Vault: ${shortAddr(vault.contract_address)}`}
                </div>
              </div>

              {/* Tabs: Position / Epoch */}
              <div className="vd-card" style={{ padding: 0 }}>
                <div className="vd-tabs" style={{ padding: '0 20px' }}>
                  {(['deposit', 'position', 'epoch'] as const).map(t => (
                    <button key={t} className={`vd-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                      {t === 'deposit' ? 'Deposit' : t === 'position' ? `Position${deposits.length > 0 ? ` (${deposits.length})` : ''}` : 'Epoch'}
                    </button>
                  ))}
                </div>

                <div style={{ padding: '0 20px 20px' }}>

                  {/* ── Deposit tab ── */}
                  {tab === 'deposit' && (
                    <DepositPanel vault={vault} onDeposited={() => { loadVault(); setTab('position') }} />
                  )}

                  {/* ── Position tab ── */}
                  {tab === 'position' && (
                    <div>
                      {deposits.length === 0 && queue.length === 0 ? (
                        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)', fontSize: 13 }}>
                          No active deposits.{' '}
                          <button onClick={() => setTab('deposit')} style={{ color: 'var(--color-mw-brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-jakarta)' }}>
                            Deposit now →
                          </button>
                        </div>
                      ) : (
                        <>
                          <div style={{ padding: '12px 0', borderBottom: '1px solid var(--color-mw-border)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                              Total deposited
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-mw-brand)' }}>
                              {fmtUSD(totalDeposited)}
                            </span>
                          </div>
                          {withErr && (
                            <div style={{ fontSize: 12, color: 'var(--color-mw-red)', background: 'rgba(239,68,68,0.06)', padding: '8px 12px', borderRadius: 6, marginBottom: 8, fontFamily: 'var(--font-jakarta)' }}>
                              {withErr}
                            </div>
                          )}
                          {deposits.map(d => (
                            <PositionRow
                              key={d.id}
                              deposit={d}
                              onWithdraw={id => { setWithErr(''); handleWithdraw(id) }}
                            />
                          ))}
                          {queue.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-mw-ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-jakarta)', marginBottom: 8 }}>
                                Pending withdrawals
                              </div>
                              {queue.map(q => (
                                <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--color-mw-border)' }}>
                                  <div>
                                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-mw-ink)' }}>
                                      {fmtUSD(q.requested_amount)}
                                      {q.penalty_pct > 0 && <span style={{ fontSize: 11, color: 'var(--color-mw-red)', marginLeft: 6 }}>−{q.penalty_pct}%</span>}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta)' }}>
                                      Executable {daysUntil(q.executable_at) === 0 ? 'today' : `in ${daysUntil(q.executable_at)}d`}
                                    </div>
                                  </div>
                                  <span className="mw-pill mw-pill-soon">Pending</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      {withdrawing && <div style={{ fontSize: 12, color: 'var(--color-mw-ink-3)', marginTop: 8, fontFamily: 'var(--font-jakarta)' }}>Processing withdrawal…</div>}
                    </div>
                  )}

                  {/* ── Epoch tab ── */}
                  {tab === 'epoch' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {!epoch ? (
                        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)', fontSize: 13 }}>
                          No active epoch yet.
                        </div>
                      ) : (
                        <>
                          {[
                            { label: 'Epoch',        value: `#${epoch.epoch_number}` },
                            { label: 'Total pool',   value: fmtUSD(epoch.total_pool) },
                            { label: 'Bonus pool',   value: epoch.bonus_pool > 0 ? fmtUSD(epoch.bonus_pool) : '—' },
                            { label: 'Claimed',      value: fmtUSD(epoch.total_claimed) },
                            { label: 'Status',       value: epoch.status.charAt(0).toUpperCase() + epoch.status.slice(1) },
                            { label: 'Opened',       value: new Date(epoch.opened_at).toLocaleDateString() },
                            { label: 'Deadline',     value: epoch.deadline ? `${daysUntil(epoch.deadline)}d remaining` : 'Active' },
                          ].map(({ label, value }) => (
                            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-mw-border)' }}>
                              <span style={{ fontSize: 12, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>{label}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-mw-ink)' }}>{value}</span>
                            </div>
                          ))}
                          {epoch.merkle_root && (
                            <div style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', padding: '8px 12px', background: 'var(--color-mw-surface)', borderRadius: 6 }}>
                              Root: {epoch.merkle_root.slice(0, 16)}…
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                </div>
              </div>
            </div>

            {/* ── Right: info panel ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Fee split */}
              <div className="vd-card">
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-mw-ink-2)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-jakarta)', marginBottom: 14 }}>
                  Fee split
                </div>
                {[
                  { label: 'LPs (you)',            pct: 70, color: 'var(--color-mw-brand)' },
                  { label: 'Referrers',             pct: 15, color: 'var(--color-mw-pink)' },
                  { label: 'Protocol treasury',    pct: 10, color: 'var(--color-mw-ink-3)' },
                  { label: 'Attribution bonus pool', pct: 5, color: 'var(--color-mw-amber)' },
                ].map(({ label, pct, color }) => (
                  <div key={label} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--color-mw-ink-3)', fontFamily: 'var(--font-jakarta)' }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{pct}%</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: 'var(--color-mw-border)' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Multiplier table */}
              <div className="vd-card">
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-mw-ink-2)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-jakarta)', marginBottom: 14 }}>
                  Lock tier multipliers
                </div>
                {(Object.entries(LOCK_TIERS) as [LockTier, typeof LOCK_TIERS[LockTier]][]).map(([tier, meta]) => (
                  <div key={tier} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--color-mw-border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: meta.color, fontFamily: 'var(--font-jakarta)' }}>{meta.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta)' }}>{meta.period}</div>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: meta.color }}>{meta.multiplier}</span>
                  </div>
                ))}
                <p style={{ fontSize: 11, color: 'var(--color-mw-ink-4)', fontFamily: 'var(--font-jakarta)', margin: '12px 0 0' }}>
                  Combined with your Attribution score percentile for final payout.
                </p>
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function VaultDetailPage() {
  return (
    <MwAuthGuard>
      <VaultDetailContent />
    </MwAuthGuard>
  )
}

'use client'

import { useAccount, useSignMessage } from 'wagmi'
import { useParams }  from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { MwNav }       from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { fmtUSD }      from '@/lib/web2/api'
import type { SocialVault, LpDeposit, WithdrawalQueueEntry, LockTier } from '@/lib/web2/vault/types'
import { LOCK_TIERS } from '@/lib/web2/vault/types'
import { useVaultDeposit, useVaultWithdraw, useVaultExecuteRedeem, useVaultOnchain } from '@/lib/web3/vault/useSocialVault'
import { buildVaultDepositMessage, buildVaultWithdrawMessage } from '@/lib/web3/signedActionMessages'

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

const LABEL = 'font-atx-mono uppercase tracking-[0.08em] text-[10px] text-atx-ink/55'

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

// ─── Status pill ─────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; dot: string }> = {
    active:  { label: 'Active',  dot: 'bg-atx-acid' },
    seeding: { label: 'Seeding', dot: 'bg-atx-coral' },
    paused:  { label: 'Paused',  dot: 'bg-atx-grey' },
    closed:  { label: 'Closed',  dot: 'bg-atx-grey' },
  }
  const { label, dot } = map[status] ?? { label: status, dot: 'bg-atx-grey' }
  return (
    <span className="shrink-0 flex items-center gap-1.5 border border-atx-ink px-[7px] py-[2px] font-atx-mono text-[10px] uppercase tracking-[0.08em]">
      <span className={`w-[7px] h-[7px] border border-atx-ink inline-block ${dot}`} />
      {label}
    </span>
  )
}

// ─── Lock tier selector ───────────────────────────────────────────────────────
function LockTierSelector({ value, onChange }: { value: LockTier; onChange: (t: LockTier) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(Object.entries(LOCK_TIERS) as [LockTier, typeof LOCK_TIERS[LockTier]][]).map(([tier, meta]) => (
        <button
          key={tier}
          onClick={() => onChange(tier)}
          className={`text-left px-3 py-2.5 border ${value === tier ? 'border-atx-blue bg-atx-bone' : 'border-atx-ink/30 bg-atx-panel'}`}
        >
          <div className={`text-[13px] font-bold font-atx-display mb-0.5 ${value === tier ? 'text-atx-blue' : 'text-atx-ink'}`}>
            {meta.label}
          </div>
          <div className="text-[11px] text-atx-ink/55 font-atx-mono">
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
  const { signMessageAsync } = useSignMessage()
  const [amount, setAmount]   = useState('')
  const [tier, setTier]       = useState<LockTier>('flex')
  const [success, setSuccess] = useState(false)

  const { deposit, stage, isPending, isSuccess, txHash, error, reset } = useVaultDeposit()

  // After on-chain confirm → record in DB
  useEffect(() => {
    if (!isSuccess || !address || !txHash) return
    const amountNum = parseFloat(amount)
    if (amountNum <= 0) return
    const syncDeposit = async () => {
      const issuedAt = Date.now()
      const authMessage = buildVaultDepositMessage({
        vaultId: vault.id,
        wallet: address,
        usdcAmount: amountNum,
        lockTier: tier,
        txHash,
        issuedAt,
      })
      const authSignature = await signMessageAsync({ message: authMessage })
      await fetch('/api/vault/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vault_id: vault.id,
          wallet: address,
          usdc_amount: amountNum,
          lock_tier: tier,
          tx_hash: txHash,
          issuedAt,
          authMessage,
          authSignature,
        }),
      })
    }
    syncDeposit().then(() => {
      setSuccess(true)
      setAmount('')
      onDeposited()
    }).catch(() => {
      setSuccess(true)
      onDeposited()
    })
  }, [isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDeposit() {
    if (!address || !amount || parseFloat(amount) <= 0) return
    reset()
    await deposit(parseFloat(amount), tier, address)
  }

  const stageLabel: Record<typeof stage, string> = {
    idle:       'Deposit USDC',
    resetting_approval: 'Resetting token permission…',
    approving:  'Approving USDC…',
    approved:   'Approval confirmed',
    depositing: 'Depositing…',
    success:    'Deposited!',
    error:      'Retry deposit',
  }

  if (success) return (
    <div className="text-center py-6">
      <div className="flex justify-center mb-2">
        <span className="w-4 h-4 bg-atx-acid border border-atx-ink inline-block" />
      </div>
      <div className="text-[15px] font-bold text-atx-mesquite font-atx-display">
        Deposit recorded
      </div>
      <div className="text-[13px] text-atx-ink/55 mt-1 font-atx-display">
        Your position will appear below once confirmed on-chain.
      </div>
      <button
        onClick={() => setSuccess(false)}
        className="mt-4 text-[13px] text-atx-blue font-atx-display font-semibold"
      >
        Deposit more →
      </button>
    </div>
  )

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Amount input */}
      <div>
        <label className={`${LABEL} block mb-1.5`}>
          USDC amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-atx-ink/55 font-atx-mono">$</span>
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full pl-6 pr-3 py-2.5 border border-atx-ink/30 bg-atx-panel font-atx-mono text-[15px] text-atx-ink outline-none focus:border-atx-blue box-border"
          />
        </div>
      </div>

      {/* Lock tier */}
      <div>
        <label className={`${LABEL} block mb-2`}>
          Lock tier
        </label>
        <LockTierSelector value={tier} onChange={setTier} />
      </div>

      {/* Multiplier preview */}
      <div className="bg-atx-bone border border-atx-ink/25 px-3.5 py-2.5 flex justify-between items-center">
        <span className="text-[12px] text-atx-ink/55 font-atx-display">Your fee multiplier</span>
        <span className="text-[16px] font-bold text-atx-blue font-atx-mono">
          {LOCK_TIERS[tier].multiplier}
        </span>
      </div>

      <div className="bg-atx-panel border border-atx-ink/20 px-3.5 py-2.5">
        <div className={`${LABEL} mb-1.5`}>
          What will happen
        </div>
        <div className="flex flex-col gap-1 text-[12px] text-atx-ink/60 font-atx-display leading-[1.55]">
          <div>1. Your wallet may ask for permission to let SocialVault use your USDC. That step does not move funds.</div>
          <div>2. Mintware checks the deposit call before your wallet signs the final transaction.</div>
          <div>3. Your wallet then confirms the deposit and your LP position appears after the chain confirms it.</div>
        </div>
      </div>

      {error && (
        <div className="text-[12px] text-atx-clay font-atx-display bg-atx-panel border border-atx-clay/40 px-3 py-2">
          {error}
        </div>
      )}

      {/* Stage progress */}
      {isPending && (
        <div className="text-[12px] text-atx-blue font-atx-display bg-atx-bone border border-atx-ink/25 px-3 py-2 flex items-center gap-1.5">
          <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block" />
          {stageLabel[stage]}
        </div>
      )}

      {isPending && (
        <div className="text-[11px] text-atx-ink/55 font-atx-display bg-atx-panel border border-atx-ink/20 px-3 py-2 leading-[1.5]">
          If your wallet prompt is slow, open your wallet app or extension and look for a pending request.
        </div>
      )}

      <button
        onClick={handleDeposit}
        disabled={isPending || !amount || parseFloat(amount) <= 0 || vault.status === 'closed'}
        className="p-3 bg-atx-blue text-white border border-atx-ink font-atx-mono text-[14px] font-bold disabled:opacity-50 transition-opacity"
      >
        {stageLabel[stage]}
      </button>
      <p className="text-[11px] text-atx-ink/45 font-atx-display text-center m-0">
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
    <div className="flex items-center gap-3 py-3 border-b border-atx-ink/20">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-[3px]">
          <span className="text-[15px] font-bold font-atx-mono text-atx-ink">
            {fmtUSD(deposit.usdc_amount)}
          </span>
          <span className="text-[11px] font-semibold text-atx-ink/60 font-atx-mono border border-atx-ink/25 px-[7px] py-[2px] uppercase tracking-[0.06em]">
            {tier.label}
          </span>
          {deposit.status === 'withdrawal_pending' && (
            <span className="text-[11px] text-atx-clay font-atx-mono font-semibold">
              Withdrawing
            </span>
          )}
        </div>
        <div className="text-[11px] text-atx-ink/45 font-atx-display">
          {deposit.lock_tier !== 'flex' && daysLeft > 0
            ? `${daysLeft}d remaining · ${penalty > 0 ? `${penalty}% early exit` : 'no penalty'}`
            : 'No lock · can withdraw anytime'}
          {deposit.compounded_amount > 0 && ` · +${fmtUSD(deposit.compounded_amount)} compounded`}
        </div>
      </div>
      {deposit.status === 'active' && (
        <button
          onClick={() => onWithdraw(deposit.id)}
          className="text-[12px] font-semibold text-atx-ink/60 border border-atx-ink/25 px-3 py-[5px] font-atx-mono uppercase tracking-[0.06em] hover:border-atx-ink hover:text-atx-ink"
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
  const { signMessageAsync } = useSignMessage()
  const { id }         = useParams<{ id: string }>()
  const wallet         = address?.toLowerCase() ?? ''

  const [vault, setVault]         = useState<SocialVault | null>(null)
  const [deposits, setDeposits]   = useState<LpDeposit[]>([])
  const [queue, setQueue]         = useState<WithdrawalQueueEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState<'deposit' | 'position' | 'epoch'>('deposit')
  const [withdrawing, setWith]    = useState<string | null>(null)
  const [withErr, setWithErr]     = useState('')
  const vaultWithdraw = useVaultWithdraw()
  const vaultExecute  = useVaultExecuteRedeem()

  // Live on-chain state for THIS vault's contract (authoritative; mirrors DB).
  const onchain = useVaultOnchain(vault?.contract_address, address)

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
      // Step 1: on-chain requestWithdrawal
      vaultWithdraw.withdraw(dep.usdc_amount)
      // Wait for tx — useEffect below picks up isSuccess
    } catch (e: unknown) {
      setWithErr(e instanceof Error ? e.message : 'Withdrawal failed')
      setWith(null)
    }
  }

  // After on-chain withdraw success → mirror in DB
  useEffect(() => {
    if (!vaultWithdraw.isSuccess || !withdrawing || !address) return
    const dep = deposits.find(d => d.id === withdrawing)
    if (!dep) { setWith(null); return }
    const syncWithdraw = async () => {
      const issuedAt = Date.now()
      const authMessage = buildVaultWithdrawMessage({
        depositId: withdrawing,
        wallet: address,
        requestedAmount: dep.usdc_amount,
        txHash: vaultWithdraw.txHash ?? '',
        issuedAt,
      })
      const authSignature = await signMessageAsync({ message: authMessage })
      await fetch('/api/vault/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deposit_id: withdrawing,
          wallet: address,
          requested_amount: dep.usdc_amount,
          tx_hash: vaultWithdraw.txHash,
          issuedAt,
          authMessage,
          authSignature,
        }),
      })
    }
    syncWithdraw()
      .then(() => { loadVault(); setTab('position') })
      .catch(() => { loadVault() })
      .finally(() => setWith(null))
  }, [vaultWithdraw.isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  // Step 2: settle a queued withdrawal on-chain once its notice period has elapsed.
  function handleComplete() {
    if (!address) return
    setWithErr('')
    vaultExecute.execute()
  }

  // After executeRedeem success → refresh (the on-chain request is settled).
  useEffect(() => {
    if (!vaultExecute.isSuccess) return
    loadVault()
    vaultExecute.reset()
  }, [vaultExecute.isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div className="px-7 py-10 max-w-[900px] mx-auto">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-20 bg-atx-panel border border-atx-ink/20 animate-pulse mb-3" />
      ))}
    </div>
  )

  if (!vault) return (
    <div className="px-7 py-[60px] text-center text-atx-ink/55 font-atx-display">
      Vault not found. <Link href="/vaults" className="text-atx-blue">← Back to vaults</Link>
    </div>
  )

  // Single-surface DeFi vault — the LP detail renders below.

  const epoch       = vault.current_epoch
  const totalDeposited = deposits.reduce((s, d) => s + d.usdc_amount, 0)

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink">
      <MwNav />
      <div className="max-w-[960px] mx-auto px-7 pt-7 pb-[60px] max-[800px]:px-4 max-[800px]:pt-5 [&_*]:rounded-none">

        {/* ── Breadcrumb ── */}
        <div className="mb-4 flex items-center gap-2">
          <Link href="/vaults" className="text-[13px] text-atx-ink/55 font-atx-display no-underline hover:text-atx-ink">
            ← Vaults
          </Link>
          <span className="text-atx-ink/30">/</span>
          <span className="text-[13px] text-atx-ink font-atx-display font-semibold">{vault.name}</span>
        </div>

        <div className="grid grid-cols-[1fr_360px] gap-5 items-start max-[760px]:grid-cols-1">

          {/* ── Left: vault info + tabs ── */}
          <div className="flex flex-col gap-4">

            {/* Vault header card */}
            <div className="bg-atx-panel border border-atx-ink p-6">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 border border-atx-ink bg-atx-bone flex items-center justify-center shrink-0">
                    <Star className="w-6 h-6 text-atx-coral" />
                  </div>
                  <div>
                    <div className="text-[18px] font-extrabold text-atx-ink font-atx-display leading-[1.2]">{vault.name}</div>
                    <div className="text-[11px] text-atx-ink/45 font-atx-mono mt-0.5">
                      {shortAddr(vault.project_token)} · chain {vault.chain_id}
                    </div>
                  </div>
                </div>
                <StatusPill status={vault.status} />
              </div>

              <div className="flex gap-5 flex-wrap mb-5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[22px] font-bold font-atx-mono text-atx-blue">{vault.tvl_usdc > 0 ? fmtUSD(vault.tvl_usdc) : '—'}</span>
                  <span className={LABEL}>TVL</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[22px] font-bold font-atx-mono text-atx-mesquite">{epoch?.total_pool ? fmtUSD(epoch.total_pool) : '—'}</span>
                  <span className={LABEL}>Epoch pool</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[22px] font-bold font-atx-mono text-atx-ink">{epoch?.epoch_number ?? '—'}</span>
                  <span className={LABEL}>Epoch</span>
                </div>
                {vault.tick_lower != null && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[14px] font-bold font-atx-mono text-atx-ink">
                      [{vault.tick_lower}, {vault.tick_upper}]
                    </span>
                    <span className={LABEL}>Tick range</span>
                  </div>
                )}
              </div>

              {/* Hook address */}
              <div className="text-[11px] text-atx-ink/45 font-atx-mono px-3 py-2 bg-atx-bone border border-atx-ink/20">
                Hook: {shortAddr(vault.pool_key?.hooks ?? '0x0000')}
                {vault.contract_address && ` · Vault: ${shortAddr(vault.contract_address)}`}
              </div>
            </div>

            {/* Tabs: Position / Epoch */}
            <div className="bg-atx-panel border border-atx-ink">
              <div className="flex border-b border-atx-ink/20 px-5">
                {(['deposit', 'position', 'epoch'] as const).map(t => (
                  <button
                    key={t}
                    className={`px-4 py-2.5 text-[13px] font-semibold font-atx-display -mb-px border-b-2 ${tab === t ? 'text-atx-blue border-atx-blue' : 'text-atx-ink/55 border-transparent'}`}
                    onClick={() => setTab(t)}
                  >
                    {t === 'deposit' ? 'Deposit' : t === 'position' ? `Position${deposits.length > 0 ? ` (${deposits.length})` : ''}` : 'Epoch'}
                  </button>
                ))}
              </div>

              <div className="px-5 pb-5">

                {/* ── Deposit tab ── */}
                {tab === 'deposit' && (
                  <DepositPanel vault={vault} onDeposited={() => { loadVault(); setTab('position') }} />
                )}

                {/* ── Position tab ── */}
                {tab === 'position' && (
                  <div>
                    {/* Live on-chain position — read straight from the vault contract */}
                    {address && onchain.enabled && (
                      <div className="border border-atx-ink bg-atx-bone px-4 py-3.5 mb-3">
                        <div className="flex items-center justify-between mb-2.5">
                          <span className={LABEL}>On-chain position</span>
                          <span className="flex items-center gap-1.5 font-atx-mono text-[9px] uppercase tracking-[0.1em] text-atx-ink/55">
                            <span className="w-[7px] h-[7px] bg-atx-acid border border-atx-ink inline-block" />
                            Live
                          </span>
                        </div>
                        {onchain.isLoading && !onchain.position ? (
                          <div className="text-[12px] text-atx-ink/45 font-atx-mono">Reading chain…</div>
                        ) : onchain.position?.hasPosition ? (
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                            <div>
                              <div className="text-[18px] font-bold font-atx-mono text-atx-blue leading-none">{fmtUSD(onchain.position.usdcDeposited)}</div>
                              <div className={`${LABEL} mt-1`}>Deposited (USDC)</div>
                            </div>
                            <div>
                              <div className="text-[14px] font-bold font-atx-mono text-atx-ink leading-none capitalize">{onchain.position.tier}</div>
                              <div className={`${LABEL} mt-1`}>Lock tier</div>
                            </div>
                            <div>
                              <div className="text-[13px] font-atx-mono text-atx-ink leading-none">
                                {onchain.position.lockedUntil * 1000 > Date.now()
                                  ? `${Math.ceil((onchain.position.lockedUntil * 1000 - Date.now()) / 86_400_000)}d left`
                                  : 'Unlocked'}
                              </div>
                              <div className={`${LABEL} mt-1`}>Lock status</div>
                            </div>
                            <div>
                              <div className="text-[13px] font-atx-mono text-atx-ink leading-none">{onchain.position.compoundEnabled ? 'On' : 'Off'}</div>
                              <div className={`${LABEL} mt-1`}>Auto-compound</div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[12px] text-atx-ink/45 font-atx-mono">No position for this wallet on-chain yet.</div>
                        )}
                      </div>
                    )}

                    {deposits.length === 0 && queue.length === 0 ? (
                      onchain.position?.hasPosition ? null : (
                      <div className="py-8 text-center text-atx-ink/55 font-atx-display text-[13px]">
                        No active deposits.{' '}
                        <button onClick={() => setTab('deposit')} className="text-atx-blue font-semibold text-[13px] font-atx-display">
                          Deposit now →
                        </button>
                      </div>
                      )
                    ) : (
                      <>
                        <div className="py-3 border-b border-atx-ink/20 mb-1 flex justify-between">
                          <span className={LABEL}>
                            Total deposited
                          </span>
                          <span className="text-[14px] font-bold font-atx-mono text-atx-blue">
                            {fmtUSD(totalDeposited)}
                          </span>
                        </div>
                        {withErr && (
                          <div className="text-[12px] text-atx-clay bg-atx-panel border border-atx-clay/40 px-3 py-2 mb-2 font-atx-display">
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
                          <div className="mt-4">
                            <div className={`${LABEL} mb-2`}>
                              Pending withdrawals
                            </div>
                            {queue.map(q => (
                              <div key={q.id} className="flex justify-between items-center py-2.5 border-b border-atx-ink/20">
                                <div>
                                  <div className="text-[14px] font-bold font-atx-mono text-atx-ink">
                                    {fmtUSD(q.requested_amount)}
                                    {q.penalty_pct > 0 && <span className="text-[11px] text-atx-clay ml-1.5">−{q.penalty_pct}%</span>}
                                  </div>
                                  <div className="text-[11px] text-atx-ink/45 font-atx-display">
                                    Executable {daysUntil(q.executable_at) === 0 ? 'today' : `in ${daysUntil(q.executable_at)}d`}
                                  </div>
                                </div>
                                {new Date(q.executable_at) <= new Date() ? (
                                  <button
                                    onClick={handleComplete}
                                    disabled={vaultExecute.isPending}
                                    className="shrink-0 text-[11px] font-semibold text-atx-ink border border-atx-ink px-3 py-[4px] font-atx-mono uppercase tracking-[0.06em] hover:bg-atx-ink hover:text-atx-bone disabled:opacity-50"
                                  >
                                    {vaultExecute.isPending ? 'Completing…' : 'Complete withdrawal'}
                                  </button>
                                ) : (
                                  <span className="shrink-0 flex items-center gap-1.5 border border-atx-ink px-[7px] py-[2px] font-atx-mono text-[10px] uppercase tracking-[0.08em]">
                                    <span className="w-[7px] h-[7px] border border-atx-ink inline-block bg-atx-coral" />
                                    Pending
                                  </span>
                                )}
                              </div>
                            ))}
                            {vaultExecute.error && (
                              <div className="text-[11px] text-atx-clay font-atx-display mt-2">{vaultExecute.error}</div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {withdrawing && <div className="text-[12px] text-atx-ink/55 mt-2 font-atx-display">Processing withdrawal…</div>}
                  </div>
                )}

                {/* ── Epoch tab ── */}
                {tab === 'epoch' && (
                  <div className="flex flex-col gap-3">
                    {!epoch ? (
                      <div className="py-8 text-center text-atx-ink/55 font-atx-display text-[13px]">
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
                          <div key={label} className="flex justify-between py-2 border-b border-atx-ink/20">
                            <span className="text-[12px] text-atx-ink/55 font-atx-display">{label}</span>
                            <span className="text-[13px] font-semibold font-atx-mono text-atx-ink">{value}</span>
                          </div>
                        ))}
                        {epoch.merkle_root && (
                          <div className="text-[11px] text-atx-ink/45 font-atx-mono break-all px-3 py-2 bg-atx-bone border border-atx-ink/20">
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
          <div className="flex flex-col gap-4">

            {/* Fee split */}
            <div className="bg-atx-panel border border-atx-ink p-6">
              <div className="font-atx-mono uppercase tracking-[0.1em] text-[12px] text-atx-ink/60 mb-3.5">
                Fee split
              </div>
              {[
                { label: 'LPs (you)',              pct: 70, bar: 'bg-atx-blue',     txt: 'text-atx-blue' },
                { label: 'Referrers',              pct: 15, bar: 'bg-atx-coral',    txt: 'text-atx-coral' },
                { label: 'Protocol treasury',      pct: 10, bar: 'bg-atx-grey',     txt: 'text-atx-ink/55' },
                { label: 'Attribution bonus pool', pct: 5,  bar: 'bg-atx-clay',     txt: 'text-atx-clay' },
              ].map(({ label, pct, bar, txt }) => (
                <div key={label} className="mb-2.5">
                  <div className="flex justify-between mb-1">
                    <span className="text-[12px] text-atx-ink/55 font-atx-display">{label}</span>
                    <span className={`text-[13px] font-bold font-atx-mono ${txt}`}>{pct}%</span>
                  </div>
                  <div className="h-[8px] border border-atx-ink overflow-hidden relative">
                    <div className={`absolute inset-y-0 left-0 ${bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Multiplier table */}
            <div className="bg-atx-panel border border-atx-ink p-6">
              <div className="font-atx-mono uppercase tracking-[0.1em] text-[12px] text-atx-ink/60 mb-3.5">
                Lock tier multipliers
              </div>
              {(Object.entries(LOCK_TIERS) as [LockTier, typeof LOCK_TIERS[LockTier]][]).map(([tier, meta]) => (
                <div key={tier} className="flex justify-between items-center py-[7px] border-b border-atx-ink/20">
                  <div>
                    <div className="text-[13px] font-semibold text-atx-ink font-atx-display">{meta.label}</div>
                    <div className="text-[11px] text-atx-ink/45 font-atx-display">{meta.period}</div>
                  </div>
                  <span className="text-[15px] font-bold font-atx-mono text-atx-blue">{meta.multiplier}</span>
                </div>
              ))}
              <p className="text-[11px] text-atx-ink/45 font-atx-display mt-3">
                Combined with your Attribution score percentile for final payout.
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
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

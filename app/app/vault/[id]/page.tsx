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
import { useVaultDeposit, useVaultWithdraw, useVaultExecuteRedeem, useVaultOnchain, TOKEN0_SYMBOL, TOKEN1_SYMBOL } from '@/lib/web3/vault/useSocialVault'
import { buildVaultDepositMessage, buildVaultWithdrawMessage } from '@/lib/web3/signedActionMessages'

// Design v2 (Privy-esque). Styling only — all on-chain deposit/withdraw logic unchanged.

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

const LABEL = 'uppercase tracking-[0.08em] text-[10px] font-semibold text-ink-soft'
const INPUT = 'w-full pl-16 pr-3 py-2.5 rounded-xl border border-hair bg-white font-mono text-[15px] text-ink outline-none focus:border-[rgba(108,108,240,0.5)] box-border placeholder:text-ink-soft'

// ─── Status pill ─────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; dot: string }> = {
    active:  { label: 'Active',  dot: 'bg-peri' },
    seeding: { label: 'Seeding', dot: 'bg-coral2' },
    paused:  { label: 'Paused',  dot: 'bg-ink-soft' },
    closed:  { label: 'Closed',  dot: 'bg-ink-soft' },
  }
  const { label, dot } = map[status] ?? { label: status, dot: 'bg-ink-soft' }
  return (
    <span className="shrink-0 flex items-center gap-1.5 rounded-full border border-hair px-2.5 py-[3px] text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-mid">
      <span className={`w-[7px] h-[7px] rounded-full inline-block ${dot}`} />
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
          className={`text-left px-3 py-2.5 rounded-xl border ${value === tier ? 'border-[rgba(108,108,240,0.4)] bg-[rgba(108,108,240,0.06)]' : 'border-hair bg-white'}`}
        >
          <div className={`text-[13px] font-semibold font-atx-display mb-0.5 ${value === tier ? 'text-peri-deep' : 'text-ink'}`}>
            {meta.label}
          </div>
          <div className="text-[11px] text-ink-soft">
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
  const [amount, setAmount]   = useState('')   // token0 = USDC (6dp)
  const [amount1, setAmount1] = useState('')   // token1 = WETH (18dp)
  const [tier, setTier]       = useState<LockTier>('flex')
  const [success, setSuccess] = useState(false)

  const { deposit, stage, isPending, isSuccess, txHash, error, reset } = useVaultDeposit()

  // After on-chain confirm → record in DB. `usdc_amount` records the USDC (token0) side.
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
      setAmount1('')
      onDeposited()
    }).catch(() => {
      setSuccess(true)
      onDeposited()
    })
  }, [isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  const amt0 = parseFloat(amount) || 0
  const amt1 = parseFloat(amount1) || 0

  async function handleDeposit() {
    if (!address || (amt0 <= 0 && amt1 <= 0)) return
    reset()
    await deposit(amt0, amt1, tier, address)
  }

  const stageLabel: Record<typeof stage, string> = {
    idle:       'Deposit liquidity',
    switching_chain: 'Switch to Base Sepolia…',
    approving:  `Approving ${TOKEN0_SYMBOL} + ${TOKEN1_SYMBOL}…`,
    approved:   'Approvals confirmed',
    depositing: 'Depositing…',
    success:    'Deposited!',
    error:      'Retry deposit',
  }

  if (success) return (
    <div className="text-center py-6">
      <div className="flex justify-center mb-2">
        <span className="w-4 h-4 rounded-full bg-peri inline-block" />
      </div>
      <div className="text-[15px] font-semibold text-peri-deep font-atx-display">
        Deposit recorded
      </div>
      <div className="text-[13px] text-ink-mid mt-1">
        Your position will appear below once confirmed on-chain.
      </div>
      <button
        onClick={() => setSuccess(false)}
        className="mt-4 text-[13px] text-peri-deep font-semibold"
      >
        Deposit more →
      </button>
    </div>
  )

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Dual-token amount inputs — the pair vault takes BOTH sides */}
      <div>
        <label className={`${LABEL} block mb-1.5`}>
          {TOKEN0_SYMBOL} amount (token0)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-soft font-mono">{TOKEN0_SYMBOL}</span>
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className={INPUT}
          />
        </div>
      </div>
      <div>
        <label className={`${LABEL} block mb-1.5`}>
          {TOKEN1_SYMBOL} amount (token1)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-soft font-mono">{TOKEN1_SYMBOL}</span>
          <input
            type="number"
            placeholder="0.00"
            value={amount1}
            onChange={e => setAmount1(e.target.value)}
            className={INPUT}
          />
        </div>
        <span className="block mt-1 text-[11px] text-ink-soft">
          Provide both tokens in roughly the pool ratio. Unused dust is refunded on-chain.
        </span>
      </div>

      {/* Lock tier */}
      <div>
        <label className={`${LABEL} block mb-2`}>
          Lock tier
        </label>
        <LockTierSelector value={tier} onChange={setTier} />
      </div>

      {/* Multiplier preview */}
      <div className="rounded-xl bg-[rgba(108,108,240,0.06)] border border-[rgba(108,108,240,0.2)] px-3.5 py-2.5 flex justify-between items-center">
        <span className="text-[12px] text-ink-mid">Your fee multiplier</span>
        <span className="text-[16px] font-semibold text-peri-deep font-atx-display tabular-nums">
          {LOCK_TIERS[tier].multiplier}
        </span>
      </div>

      <div className="soft-card px-3.5 py-2.5">
        <div className={`${LABEL} mb-1.5`}>
          What will happen
        </div>
        <div className="flex flex-col gap-1 text-[12px] text-ink-mid leading-[1.55]">
          <div>1. Your wallet approves the vault to use your {TOKEN0_SYMBOL} and {TOKEN1_SYMBOL}. Those steps do not move funds.</div>
          <div>2. Mintware simulates the deposit call before your wallet signs the final transaction.</div>
          <div>3. Your wallet then confirms the deposit and your LP position appears after the chain confirms it.</div>
        </div>
      </div>

      {error && (
        <div className="text-[12px] text-[#D14343] rounded-xl bg-[rgba(209,67,67,0.05)] border border-[rgba(209,67,67,0.3)] px-3 py-2">
          {error}
        </div>
      )}

      {/* Stage progress */}
      {isPending && (
        <div className="text-[12px] text-peri-deep rounded-xl bg-[rgba(108,108,240,0.06)] border border-[rgba(108,108,240,0.2)] px-3 py-2 flex items-center gap-1.5">
          <span className="w-[8px] h-[8px] rounded-full bg-peri inline-block animate-pulse" />
          {stageLabel[stage]}
        </div>
      )}

      {isPending && (
        <div className="text-[11px] text-ink-mid rounded-xl bg-ground-cool border border-hair px-3 py-2 leading-[1.5]">
          If your wallet prompt is slow, open your wallet app or extension and look for a pending request.
        </div>
      )}

      <button
        onClick={handleDeposit}
        disabled={isPending || (amt0 <= 0 && amt1 <= 0) || vault.status === 'closed'}
        className="glass-pill w-full justify-center !py-3 disabled:opacity-50"
      >
        {stageLabel[stage]}
      </button>
      <p className="text-[11px] text-ink-soft text-center m-0">
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
    <div className="flex items-center gap-3 py-3 border-b border-hair-soft">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-[3px]">
          <span className="text-[15px] font-atx-display font-medium text-ink tabular-nums">
            {fmtUSD(deposit.usdc_amount)}
          </span>
          <span className="text-[11px] font-semibold text-ink-mid rounded-full border border-hair px-2 py-[2px] uppercase tracking-[0.06em]">
            {tier.label}
          </span>
          {deposit.status === 'withdrawal_pending' && (
            <span className="text-[11px] text-[#D14343] font-semibold">
              Withdrawing
            </span>
          )}
        </div>
        <div className="text-[11px] text-ink-soft">
          {deposit.lock_tier !== 'flex' && daysLeft > 0
            ? `${daysLeft}d remaining · ${penalty > 0 ? `${penalty}% early exit` : 'no penalty'}`
            : 'No lock · can withdraw anytime'}
          {deposit.compounded_amount > 0 && ` · +${fmtUSD(deposit.compounded_amount)} compounded`}
        </div>
      </div>
      {deposit.status === 'active' && (
        <button
          onClick={() => onWithdraw(deposit.id)}
          className="glass-pill glass-pill-sm"
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
    try {
      const [vRes, dRes] = await Promise.all([
        fetch(`/api/vault?id=${id}`).then(r => r.json()),
        wallet ? fetch(`/api/vault?address=${wallet}`).then(r => r.json()) : Promise.resolve({ deposits: [], withdrawal_queue: [] }),
      ])
      setVault(vRes?.error ? null : vRes)
      if (!vRes?.error) {
        setDeposits((dRes.deposits ?? []).filter((d: LpDeposit) => d.vault_id === id || (d as LpDeposit & { vault?: { id: string } }).vault?.id === id))
        setQueue((dRes.withdrawal_queue ?? []).filter((q: WithdrawalQueueEntry) => q.vault_id === id))
      }
    } catch {
      setVault(null) // network/parse failure → clean "not found" state, not an infinite skeleton
    } finally {
      setLoading(false)
    }
  }, [id, wallet])

  useEffect(() => { loadVault() }, [loadVault])

  async function handleWithdraw(depositId: string) {
    const dep = deposits.find(d => d.id === depositId)
    if (!dep || !address) return
    // The pair vault tracks ONE share balance per wallet (shares = V4 liquidity units),
    // so a redeem request operates on the wallet's whole on-chain position, not a single
    // DB deposit row. Require a live position before requesting.
    const shares = onchain.position?.shares
    if (!shares || shares <= 0n) {
      setWithErr('No on-chain position to withdraw yet. Give the deposit a moment to confirm.')
      return
    }
    setWith(depositId); setWithErr('')
    try {
      // Step 1: on-chain requestRedeem(shares) — queues the 7-day notice.
      vaultWithdraw.withdraw(shares)
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
        <div key={i} className="h-20 rounded-2xl bg-ground-cool mw-shimmer mb-3" />
      ))}
    </div>
  )

  if (!vault) return (
    <div className="px-7 py-[60px] text-center text-ink-mid">
      Vault not found. <Link href="/app/vaults" className="text-peri-deep">← Back to vaults</Link>
    </div>
  )

  // Single-surface DeFi vault — the LP detail renders below.

  const epoch       = vault.current_epoch
  const totalDeposited = deposits.reduce((s, d) => s + d.usdc_amount, 0)

  return (
    <div className="bg-white min-h-screen font-atx-display text-ink">
      <MwNav />
      <div className="max-w-[960px] mx-auto px-7 pt-7 pb-[60px] max-[800px]:px-4 max-[800px]:pt-5">

        {/* ── Breadcrumb ── */}
        <div className="mb-4 flex items-center gap-2">
          <Link href="/app/vaults" className="text-[13px] text-ink-mid no-underline hover:text-ink">
            ← Vaults
          </Link>
          <span className="text-ink-soft">/</span>
          <span className="text-[13px] text-ink font-semibold">{vault.name}</span>
        </div>

        <div className="grid grid-cols-[1fr_360px] gap-5 items-start max-[760px]:grid-cols-1">

          {/* ── Left: vault info + tabs ── */}
          <div className="flex flex-col gap-4">

            {/* Vault header card */}
            <div className="soft-card p-6">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl grid place-items-center text-white text-[18px] shrink-0" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))', boxShadow: '0 4px 14px rgba(108,108,240,0.35)' }}>
                    {vault.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-[18px] font-medium text-ink font-atx-display leading-[1.2] tracking-[-0.01em]">{vault.name}</div>
                    <div className="text-[11px] text-ink-soft font-mono mt-0.5">
                      {shortAddr(vault.project_token)} · chain {vault.chain_id}
                    </div>
                  </div>
                </div>
                <StatusPill status={vault.status} />
              </div>

              <div className="flex gap-5 flex-wrap mb-5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[22px] font-atx-display font-medium text-peri-deep tabular-nums">{vault.tvl_usdc > 0 ? fmtUSD(vault.tvl_usdc) : '—'}</span>
                  <span className={LABEL}>TVL</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[22px] font-atx-display font-medium text-coral2-deep tabular-nums">{epoch?.total_pool ? fmtUSD(epoch.total_pool) : '—'}</span>
                  <span className={LABEL}>Epoch pool</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[22px] font-atx-display font-medium text-ink tabular-nums">{epoch?.epoch_number ?? '—'}</span>
                  <span className={LABEL}>Epoch</span>
                </div>
                {vault.tick_lower != null && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[14px] font-mono font-medium text-ink">
                      [{vault.tick_lower}, {vault.tick_upper}]
                    </span>
                    <span className={LABEL}>Tick range</span>
                  </div>
                )}
              </div>

              {/* Hook address */}
              <div className="text-[11px] text-ink-soft font-mono px-3 py-2 rounded-xl bg-ground-cool border border-hair">
                Hook: {shortAddr(vault.pool_key?.hooks ?? '0x0000')}
                {vault.contract_address && ` · Vault: ${shortAddr(vault.contract_address)}`}
              </div>
            </div>

            {/* Tabs: Position / Epoch */}
            <div className="soft-card">
              <div className="flex border-b border-hair-soft px-5">
                {(['deposit', 'position', 'epoch'] as const).map(t => (
                  <button
                    key={t}
                    className={`px-4 py-2.5 text-[13px] font-medium font-atx-display -mb-px border-b-2 ${tab === t ? 'text-peri-deep border-peri' : 'text-ink-mid border-transparent hover:text-ink'}`}
                    onClick={() => setTab(t)}
                  >
                    {t === 'deposit' ? 'Deposit' : t === 'position' ? `Position${deposits.length > 0 ? ` (${deposits.length})` : ''}` : 'Epoch'}
                  </button>
                ))}
              </div>

              <div className="px-5 pb-5 pt-4">

                {/* ── Deposit tab ── */}
                {tab === 'deposit' && (
                  <DepositPanel vault={vault} onDeposited={() => { loadVault(); setTab('position') }} />
                )}

                {/* ── Position tab ── */}
                {tab === 'position' && (
                  <div>
                    {/* Live on-chain position — read straight from the vault contract */}
                    {address && onchain.enabled && (
                      <div className="rounded-2xl border border-hair bg-ground-cool px-4 py-3.5 mb-3">
                        <div className="flex items-center justify-between mb-2.5">
                          <span className={LABEL}>On-chain position</span>
                          <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.1em] font-semibold text-ink-soft">
                            <span className="w-[7px] h-[7px] rounded-full bg-peri inline-block animate-pulse" />
                            Live
                          </span>
                        </div>
                        {onchain.isLoading && !onchain.position ? (
                          <div className="text-[12px] text-ink-soft font-mono">Reading chain…</div>
                        ) : onchain.position?.hasPosition ? (
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                            <div>
                              <div className="text-[18px] font-medium font-atx-display text-peri-deep leading-none tabular-nums">{onchain.position.shares.toString()}</div>
                              <div className={`${LABEL} mt-1`}>Shares (liquidity units)</div>
                            </div>
                            <div>
                              <div className="text-[14px] font-medium font-atx-display text-ink leading-none capitalize">{onchain.position.tier}</div>
                              <div className={`${LABEL} mt-1`}>Lock tier</div>
                            </div>
                            <div>
                              <div className="text-[13px] font-mono text-ink leading-none">
                                {onchain.position.lockedUntil * 1000 > Date.now()
                                  ? `${Math.ceil((onchain.position.lockedUntil * 1000 - Date.now()) / 86_400_000)}d left`
                                  : 'Unlocked'}
                              </div>
                              <div className={`${LABEL} mt-1`}>Lock status</div>
                            </div>
                            <div>
                              <div className="text-[13px] font-mono text-ink leading-none">
                                {onchain.position.depositedAt > 0
                                  ? new Date(onchain.position.depositedAt * 1000).toLocaleDateString()
                                  : '—'}
                              </div>
                              <div className={`${LABEL} mt-1`}>Deposited</div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[12px] text-ink-soft font-mono">No position for this wallet on-chain yet.</div>
                        )}
                      </div>
                    )}

                    {deposits.length === 0 && queue.length === 0 ? (
                      onchain.position?.hasPosition ? null : (
                      <div className="py-8 text-center text-ink-mid text-[13px]">
                        No active deposits.{' '}
                        <button onClick={() => setTab('deposit')} className="text-peri-deep font-semibold text-[13px]">
                          Deposit now →
                        </button>
                      </div>
                      )
                    ) : (
                      <>
                        <div className="py-3 border-b border-hair-soft mb-1 flex justify-between">
                          <span className={LABEL}>
                            Total deposited
                          </span>
                          <span className="text-[14px] font-atx-display font-medium text-peri-deep tabular-nums">
                            {fmtUSD(totalDeposited)}
                          </span>
                        </div>
                        {withErr && (
                          <div className="text-[12px] text-[#D14343] rounded-xl bg-[rgba(209,67,67,0.05)] border border-[rgba(209,67,67,0.3)] px-3 py-2 mb-2">
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
                              <div key={q.id} className="flex justify-between items-center py-2.5 border-b border-hair-soft">
                                <div>
                                  <div className="text-[14px] font-atx-display font-medium text-ink tabular-nums">
                                    {fmtUSD(q.requested_amount)}
                                    {q.penalty_pct > 0 && <span className="text-[11px] text-[#D14343] ml-1.5">−{q.penalty_pct}%</span>}
                                  </div>
                                  <div className="text-[11px] text-ink-soft">
                                    Executable {daysUntil(q.executable_at) === 0 ? 'today' : `in ${daysUntil(q.executable_at)}d`}
                                  </div>
                                </div>
                                {new Date(q.executable_at) <= new Date() ? (
                                  <button
                                    onClick={handleComplete}
                                    disabled={vaultExecute.isPending}
                                    className="shrink-0 glass-pill glass-pill-sm disabled:opacity-50"
                                  >
                                    {vaultExecute.isPending ? 'Completing…' : 'Complete withdrawal'}
                                  </button>
                                ) : (
                                  <span className="shrink-0 flex items-center gap-1.5 rounded-full border border-hair px-2.5 py-[3px] text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-mid">
                                    <span className="w-[7px] h-[7px] rounded-full inline-block bg-coral2" />
                                    Pending
                                  </span>
                                )}
                              </div>
                            ))}
                            {vaultExecute.error && (
                              <div className="text-[11px] text-[#D14343] mt-2">{vaultExecute.error}</div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {withdrawing && <div className="text-[12px] text-ink-mid mt-2">Processing withdrawal…</div>}
                  </div>
                )}

                {/* ── Epoch tab ── */}
                {tab === 'epoch' && (
                  <div className="flex flex-col gap-3">
                    {!epoch ? (
                      <div className="py-8 text-center text-ink-mid text-[13px]">
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
                          <div key={label} className="flex justify-between py-2 border-b border-hair-soft">
                            <span className="text-[12px] text-ink-mid">{label}</span>
                            <span className="text-[13px] font-medium font-mono text-ink">{value}</span>
                          </div>
                        ))}
                        {epoch.merkle_root && (
                          <div className="text-[11px] text-ink-soft font-mono break-all px-3 py-2 rounded-xl bg-ground-cool border border-hair">
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
            <div className="soft-card p-6">
              <div className="uppercase tracking-[0.1em] text-[12px] font-semibold text-ink-soft mb-3.5">
                Fee split
              </div>
              {[
                { label: 'LPs (you)',              pct: 70, bar: 'bg-peri',      txt: 'text-peri-deep' },
                { label: 'Referrers',              pct: 15, bar: 'bg-coral2',    txt: 'text-coral2-deep' },
                { label: 'Protocol treasury',      pct: 10, bar: 'bg-ink-soft',  txt: 'text-ink-soft' },
                { label: 'Attribution bonus pool', pct: 5,  bar: 'bg-[#D14343]', txt: 'text-[#D14343]' },
              ].map(({ label, pct, bar, txt }) => (
                <div key={label} className="mb-2.5">
                  <div className="flex justify-between mb-1">
                    <span className="text-[12px] text-ink-mid">{label}</span>
                    <span className={`text-[13px] font-semibold tabular-nums ${txt}`}>{pct}%</span>
                  </div>
                  <div className="h-[8px] rounded-full bg-ground-cool overflow-hidden relative">
                    <div className={`absolute inset-y-0 left-0 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Multiplier table */}
            <div className="soft-card p-6">
              <div className="uppercase tracking-[0.1em] text-[12px] font-semibold text-ink-soft mb-3.5">
                Lock tier multipliers
              </div>
              {(Object.entries(LOCK_TIERS) as [LockTier, typeof LOCK_TIERS[LockTier]][]).map(([tier, meta]) => (
                <div key={tier} className="flex justify-between items-center py-[7px] border-b border-hair-soft">
                  <div>
                    <div className="text-[13px] font-semibold text-ink font-atx-display">{meta.label}</div>
                    <div className="text-[11px] text-ink-soft">{meta.period}</div>
                  </div>
                  <span className="text-[15px] font-atx-display font-medium text-peri-deep tabular-nums">{meta.multiplier}</span>
                </div>
              ))}
              <p className="text-[11px] text-ink-soft mt-3">
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

'use client'

// V2-RWAs — the retail liquidity-provider flow on a market page: get testnet dUSD → supply to the senior tranche
// (approve → depositUSDC) → redeem (redeemSenior). The user's own wallet signs and pays gas (Base Sepolia ETH).
// Copy rule: "supply" / "redeem", never deposit / savings / guaranteed / APY. LP eligibility is counsel-gated, so
// this exists on testnet only and says so.

import { useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { useChainId, usePublicClient, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { explorer, shortHash, type RwaUnit } from '@/lib/rwa/demo'
import { ERC20_ABI, RWA_VAULT_ABI, useRwaPosition } from './useRwaPosition'

const fmt = (a: bigint, d = 2) => Number(formatUnits(a, 6)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export function SupplyPanel({ unit, onChanged }: { unit: RwaUnit; onChanged?: () => void }) {
  const { address, isConnected } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const pos = useRwaPosition(unit, address as `0x${string}` | undefined)
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const pub = usePublicClient({ chainId: unit.chain.id })
  const [tab, setTab] = useState<'supply' | 'redeem'>('supply')
  const [amount, setAmount] = useState('')
  const [st, setSt] = useState<{ busy: boolean; msg?: string; ok?: boolean; hash?: string }>({ busy: false })
  const ex = explorer(unit)
  const vault = unit.demo.contracts.vault as `0x${string}`
  const usd = unit.demo.contracts.usd as `0x${string}`

  if (!isConnected || !address) {
    return (
      <Shell>
        <p className="text-[13.5px] leading-[1.55] text-ink-mid">Connect a wallet to supply testnet dUSD to this unit&apos;s senior tranche and redeem it later.</p>
        <button onClick={() => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })} className="glass-pill-primary mt-4 w-full">Connect wallet</button>
      </Shell>
    )
  }

  const run = async (label: string, fn: () => Promise<`0x${string}` | void>) => {
    setSt({ busy: true, msg: label })
    try {
      if (chainId !== unit.chain.id) { setSt({ busy: true, msg: `Switching to ${unit.chain.name}…` }); await switchChainAsync({ chainId: unit.chain.id }) }
      const hash = await fn()
      setSt({ busy: false, ok: true, msg: 'Done', hash: hash || undefined })
      setAmount(''); pos.refetch(); onChanged?.()
    } catch (e) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? 'Transaction failed'
      setSt({ busy: false, ok: false, msg: /User rejected|denied/i.test(m) ? 'Cancelled in your wallet.' : m.slice(0, 160) })
    }
  }
  const wait = async (hash: `0x${string}`) => { const r = await pub!.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw new Error('The transaction reverted.'); return hash }

  const atomic = (() => { try { return parseUnits(amount || '0', 6) } catch { return 0n } })()

  const faucet = () => run('Sending 500 test dUSD…', async () => {
    const res = await signedOrgFetch({ path: '/api/rwa/faucet', action: 'mintware-rwa-faucet', address, signMessageAsync })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.success) {
      const why: Record<string, string> = { already_claimed: 'You already claimed test dUSD today.', faucet_empty: 'The faucet is empty — try later.', trader_not_configured: 'The faucet is not configured on this deploy.' }
      throw new Error(why[j.error] ?? 'The faucet did not go through.')
    }
    return j.hash as `0x${string}`
  })

  const supply = () => run('Approve dUSD in your wallet…', async () => {
    if (atomic <= 0n) throw new Error('Enter an amount.')
    if (atomic > pos.usdBalance) throw new Error('More than your dUSD balance.')
    if (pos.allowance < atomic) await wait(await writeContractAsync({ address: usd, abi: ERC20_ABI, functionName: 'approve', args: [vault, atomic], chainId: unit.chain.id }))
    setSt({ busy: true, msg: 'Supply in your wallet…' })
    const preview = (await pub!.readContract({ address: vault, abi: RWA_VAULT_ABI, functionName: 'previewDeposit', args: [atomic] })) as bigint
    return wait(await writeContractAsync({ address: vault, abi: RWA_VAULT_ABI, functionName: 'depositUSDC', args: [atomic, (preview * 99n) / 100n, address as `0x${string}`], chainId: unit.chain.id }))
  })

  const redeem = (all: boolean) => run('Redeem in your wallet…', async () => {
    if (pos.shares <= 0n || pos.valueAtomic <= 0n) throw new Error('Nothing to redeem.')
    const shares = all ? pos.shares : (pos.shares * atomic) / pos.valueAtomic
    if (shares <= 0n) throw new Error('Enter an amount.')
    if (shares > pos.shares) throw new Error('More than your position.')
    const expect = all ? pos.valueAtomic : atomic
    return wait(await writeContractAsync({ address: vault, abi: RWA_VAULT_ABI, functionName: 'redeemSenior', args: [shares, (expect * 98n) / 100n], chainId: unit.chain.id }))
  })

  return (
    <Shell>
      <div className="grid grid-cols-2 gap-3">
        <Stat k="Your position" v={`$${fmt(pos.valueAtomic)}`} />
        <Stat k="Your test dUSD" v={`$${fmt(pos.usdBalance)}`} />
      </div>
      {pos.paused && <p className="mt-3 rounded-[12px] bg-[rgba(232,138,103,0.14)] px-3 py-2 text-[12.5px] text-[#B4532A]">The vault is paused by its guardian — supply and redemption are halted until it resumes.</p>}

      <div className="mt-4 inline-flex rounded-full border border-hair bg-white p-1" role="tablist">
        {(['supply', 'redeem'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold capitalize cursor-pointer ${tab === t ? 'bg-[rgba(108,108,240,0.12)] text-peri-deep' : 'text-ink-mid'}`}>{t}</button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Amount in dUSD</span>
        <div className="flex items-center gap-2 rounded-[14px] border border-hair bg-[#FBFBFE] px-4 py-2.5 focus-within:border-peri">
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} inputMode="decimal" placeholder="0.00" className="min-w-0 flex-1 bg-transparent text-[16px] tabular-nums outline-none" />
          <span className="text-[12.5px] font-semibold text-ink-soft">dUSD</span>
        </div>
      </label>

      {tab === 'supply' ? (
        <div className="mt-3 flex flex-col gap-2">
          <button onClick={supply} disabled={st.busy || pos.paused === true} className="glass-pill-primary w-full disabled:opacity-60">Supply liquidity</button>
          <button onClick={faucet} disabled={st.busy} className="text-[12.5px] font-semibold text-peri-deep hover:underline cursor-pointer disabled:opacity-60">Get 500 test dUSD</button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <button onClick={() => redeem(false)} disabled={st.busy || pos.paused === true} className="glass-pill-primary w-full disabled:opacity-60">Redeem</button>
          <button onClick={() => redeem(true)} disabled={st.busy || pos.shares === 0n} className="text-[12.5px] font-semibold text-peri-deep hover:underline cursor-pointer disabled:opacity-60">Redeem everything</button>
        </div>
      )}

      {st.msg && (
        <p className={`mt-3 text-[12.5px] ${st.ok === false ? 'text-[#B4532A]' : 'text-ink-mid'}`}>
          {st.msg}{st.hash && <> · <a href={ex.tx(st.hash)} target="_blank" rel="noreferrer" className="font-atx-mono text-peri-deep no-underline hover:underline">{shortHash(st.hash)} ↗</a></>}
        </p>
      )}

      <p className="mt-4 border-t border-hair-soft pt-3 text-[11.5px] leading-[1.55] text-ink-soft">
        You supply dUSD to the senior tranche and never hold the property token. Exits are in dUSD at par while the
        tranche is covered, pro-rata below that; a vault pause or an expired appraisal can halt redemptions. Variable,
        not guaranteed. Testnet only — who may supply liquidity to a real asset is still a legal question.
        Needs a little Base Sepolia ETH for gas.
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div id="supply" className="rounded-[24px] border border-[rgba(42,158,138,0.35)] bg-white p-6 scroll-mt-24">
      <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#1F7A6A]">Supply liquidity</div>
      <h3 className="mt-1.5 font-atx-display text-[19px] font-semibold tracking-[-0.01em]">Earn on the senior tranche</h3>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[14px] bg-ground-cool px-4 py-3">
      <div className="text-[11px] text-ink-soft">{k}</div>
      <div className="mt-0.5 font-atx-display text-[20px] font-semibold tabular-nums">{v}</div>
    </div>
  )
}

'use client'

// Savings — a single-asset (USDC) yield account backed by MintwareYieldVault: idle USDC earns in Aave
// via the vault's adapter, a live buffer keeps deposits spendable, and redeem() is buffer-first then
// pulls from Aave for the shortfall (large withdrawals stay seamless). No tranches here — that's the
// treasury/Vaults surface. Deposit: approve → deposit(assets, to). Withdraw: redeem(sharesForAmount).

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { formatUnits, parseUnits } from 'viem'
import { useAccount, useReadContract, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { YIELD_VAULT_ABI } from '@/lib/web3/artifacts/mintwareYieldVault'

const ERC20_ABI = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const
const CHAINS = [{ id: 84532, name: 'Base Sepolia' }]
const fmtUsd = (atomic?: bigint) => atomic === undefined ? '—' : `$${Number(formatUnits(atomic, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export default function SavingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address } = useMintwareIdentity()
  const { chainId: walletChain } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [org, setOrg] = useState<{ id: string; name: string; vault: string | null; chainId: number | null; owner: string } | null>(null)
  const [recAddr, setRecAddr] = useState('')
  const [recChain, setRecChain] = useState(84532)
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState('')

  const reload = () => fetch(`/api/orgs/${slug}/treasury${address ? `?address=${address}` : ''}`).then((r) => r.json()).then((d) => {
    if (d?.org) setOrg({ id: d.org.id, name: d.org.name, vault: d.treasuryVaultAddress, chainId: d.treasuryChainId, owner: d.org.ownerWallet ?? '' })
  }).catch(() => {})
  useEffect(() => { reload() }, [slug, address]) // eslint-disable-line react-hooks/exhaustive-deps

  const isOwner = !!(org && address && org.owner.toLowerCase() === address.toLowerCase())
  const vaultAddr = (org?.vault as `0x${string}`) ?? undefined
  const readOn = { address: vaultAddr, chainId: org?.chainId ?? undefined, query: { enabled: !!vaultAddr && !!org?.chainId } } as const

  const { data: usdcAddr }   = useReadContract({ abi: YIELD_VAULT_ABI, functionName: 'usdc',       ...readOn })
  const { data: buffer }     = useReadContract({ abi: YIELD_VAULT_ABI, functionName: 'idleBuffer',  ...readOn })
  const { data: myShares, refetch: refetchShares } = useReadContract({ abi: YIELD_VAULT_ABI, functionName: 'shares', args: address ? [address as `0x${string}`] : undefined, address: vaultAddr, chainId: org?.chainId ?? undefined, query: { enabled: !!vaultAddr && !!org?.chainId && !!address } })
  const { data: myAssets, refetch: refetchAssets }  = useReadContract({ abi: YIELD_VAULT_ABI, functionName: 'convertToAssets', args: myShares !== undefined ? [myShares as bigint] : undefined, address: vaultAddr, chainId: org?.chainId ?? undefined, query: { enabled: !!vaultAddr && !!org?.chainId && myShares !== undefined } })

  const refresh = () => { refetchShares(); refetchAssets() }

  const record = async () => {
    if (!org || !address) return
    if (!/^0x[a-fA-F0-9]{40}$/.test(recAddr)) return setStatus('Enter a valid vault address.')
    setStatus('Signing…')
    const res = await signedOrgFetch({ path: `/api/orgs/${org.id}/treasury`, action: 'mintware-org-treasury', method: 'PATCH', payload: { treasuryVaultAddress: recAddr, treasuryChainId: recChain }, address, signMessageAsync })
    const d = await res.json()
    setStatus(res.ok ? 'Savings vault recorded ✓' : d.error || 'failed')
    if (res.ok) reload()
  }

  const ensureChain = async () => { if (org && walletChain !== org.chainId) { setStatus('Switching chain…'); await switchChainAsync({ chainId: org.chainId! }) } }

  const deposit = async () => {
    if (!vaultAddr || !org?.chainId || !address || !usdcAddr) return setStatus('Savings not ready.')
    const atomic = (() => { try { return parseUnits(amount || '0', 6) } catch { return 0n } })()
    if (atomic <= 0n) return setStatus('Enter a valid amount.')
    try {
      await ensureChain()
      setStatus('Approve USDC…')
      await writeContractAsync({ abi: ERC20_ABI, address: usdcAddr as `0x${string}`, functionName: 'approve', args: [vaultAddr, atomic], chainId: org.chainId })
      setStatus('Depositing to Savings…')
      await writeContractAsync({ abi: YIELD_VAULT_ABI, address: vaultAddr, functionName: 'deposit', args: [atomic, address as `0x${string}`], chainId: org.chainId })
      setStatus(`Deposited ${amount} USDC to Savings ✓`)
      setAmount(''); refresh()
    } catch (e) { setStatus((e as Error)?.message?.slice(0, 140) || 'transaction failed') }
  }

  const withdraw = async (max = false) => {
    if (!vaultAddr || !org?.chainId || myShares === undefined) return setStatus('Savings not ready.')
    const shares = myShares as bigint
    if (shares <= 0n) return setStatus('No savings to withdraw.')
    let sharesToBurn = shares
    if (!max) {
      const atomic = (() => { try { return parseUnits(amount || '0', 6) } catch { return 0n } })()
      if (atomic <= 0n) return setStatus('Enter a valid amount.')
      const assets = (myAssets as bigint | undefined) ?? 0n
      if (assets <= 0n) return setStatus('Savings balance is loading — try again.')
      if (atomic >= assets) sharesToBurn = shares
      else sharesToBurn = (shares * atomic) / assets // exact NAV math; floor keeps it ≤ balance
      if (sharesToBurn <= 0n) return setStatus('Amount too small.')
    }
    try {
      await ensureChain()
      setStatus('Withdrawing (buffer-first)…')
      await writeContractAsync({ abi: YIELD_VAULT_ABI, address: vaultAddr, functionName: 'redeem', args: [sharesToBurn], chainId: org.chainId })
      setStatus(max ? 'Withdrew all savings ✓' : `Withdrew ${amount} USDC ✓`)
      setAmount(''); refresh()
    } catch (e) { setStatus((e as Error)?.message?.slice(0, 140) || 'transaction failed') }
  }

  return (
    <MwAuthGuard>
      <div className="min-h-screen font-atx-display bg-white text-ink">
        <MwNav />
        <main className="mx-auto max-w-[600px] px-6 max-[700px]:px-4 py-[44px]">
          <Link href={`/app/org/${slug}`} className="text-[12.5px] text-peri-deep no-underline hover:underline">← {org?.name || 'Org'}</Link>
          <h1 className="font-atx-display font-semibold text-[26px] tracking-[-0.03em] mt-3">Savings</h1>
          <p className="text-[13px] text-ink-mid mt-2 leading-[1.5] max-w-[54ch]">Park <span className="font-semibold text-ink">USDC</span> — it earns yield in Aave, a live buffer keeps it spendable, and withdrawals come out of the buffer first (large ones pull from Aave on demand, so they stay seamless). Want to provide <span className="font-semibold text-ink">both assets</span> as liquidity instead? That's <Link href="/app/vaults" className="text-peri-deep no-underline hover:underline font-medium">Vaults</Link>.</p>

          {org && !org.vault ? (
            <div className="soft-card p-5 mt-6">
              <div className="text-[13.5px] font-semibold text-ink">One-time setup</div>
              <p className="text-[12.5px] text-ink-mid mt-1.5 leading-[1.5]">Savings is held by an on-chain yield vault that's provisioned once — then you just deposit. Today an operator deploys it and records the address below; auto-provisioning is on the roadmap.</p>
              <div className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-ink-soft mt-3 mb-1.5">Operator — deploy once</div>
              <code className="block font-mono text-[11.5px] text-ink-mid bg-ground-cool rounded-[10px] px-3 py-2.5 overflow-x-auto whitespace-nowrap">pnpm forge:deploy:savings:base-sepolia</code>
              {isOwner ? (
                <div className="flex gap-2 mt-4 max-[520px]:flex-col">
                  <input value={recAddr} onChange={(e) => setRecAddr(e.target.value)} placeholder="0x… savings vault address" className="flex-1 rounded-[10px] border border-hair px-3 py-2.5 text-[13px] font-mono outline-none focus:border-peri" />
                  <select value={recChain} onChange={(e) => setRecChain(Number(e.target.value))} className="rounded-[10px] border border-hair px-3 py-2.5 text-[13px] bg-white outline-none focus:border-peri">{CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  <button onClick={record} className="rounded-full bg-peri text-white px-4 py-2.5 text-[13px] font-semibold hover:bg-peri-deep transition-colors">Record</button>
                </div>
              ) : <p className="text-[12px] text-ink-soft mt-3">Only the org owner can set up Savings.</p>}
            </div>
          ) : org ? (
            <>
              <div className="grid grid-cols-2 gap-3 mt-6">
                <div className="soft-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-ink-soft">Your savings</div>
                  <div className="text-[22px] font-semibold text-ink tabular-nums mt-1">{fmtUsd(myAssets as bigint | undefined)}</div>
                </div>
                <div className="soft-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-ink-soft">Available now</div>
                  <div className="text-[22px] font-semibold text-ink tabular-nums mt-1">{fmtUsd(buffer as bigint | undefined)}</div>
                  <div className="text-[11px] text-ink-soft mt-0.5">instant buffer; more unwinds from Aave on demand</div>
                </div>
              </div>

              <div className="soft-card p-5 mt-3">
                <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Amount (USDC)</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[15px] tabular-nums outline-none focus:border-peri" />
                </label>
                <div className="flex gap-2 mt-4 max-[520px]:flex-col">
                  <button onClick={deposit} className="flex-1 rounded-full bg-peri text-white px-4 py-3 text-[13.5px] font-semibold hover:bg-peri-deep transition-colors">Deposit</button>
                  <button onClick={() => withdraw(false)} className="flex-1 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-4 py-3 text-[13.5px] font-semibold hover:border-peri transition-colors">Withdraw</button>
                </div>
                <button onClick={() => withdraw(true)} className="text-[12px] text-ink-soft mt-2.5 hover:text-peri-deep transition-colors">Withdraw all →</button>
                <p className="text-[11.5px] text-ink-soft mt-3">Deposits earn Aave lending yield and stay spendable on the card. Withdrawals pull from the buffer first, then unwind from Aave for anything larger — no lockup.</p>
              </div>
            </>
          ) : null}

          {status && <div className="mt-4 rounded-[var(--radius-card)] border border-hair bg-ground-cool p-3.5 text-[13px] text-ink">{status}</div>}
        </main>
      </div>
    </MwAuthGuard>
  )
}

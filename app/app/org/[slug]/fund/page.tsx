'use client'

// Fund the treasury (#1) — two deposit screens, not a treasury-management engine. (a) If no vault is
// recorded yet: record the address of the operator's Foundry-deployed converged vault (PATCH). (b) Once
// recorded: deposit USDC (senior, par while covered) and — one click — put up first-loss (junior, commitTeam).
// Plus a "fund from another chain" link that routes via the proven CCTP flow.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { parseUnits } from 'viem'
import { useAccount, useReadContract, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'

const VAULT_ABI = [
  { type: 'function', name: 'usdc', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'depositUSDC', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'minShares', type: 'uint256' }, { name: 'to', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'commitTeam', stateMutability: 'nonpayable', inputs: [{ name: 'teamTokens', type: 'uint256' }, { name: 'juniorUSDC', type: 'uint256' }, { name: 'lockDur', type: 'uint256' }], outputs: [] },
] as const
const ERC20_ABI = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const

const CHAINS = [{ id: 84532, name: 'Base Sepolia' }]

export default function FundPage({ params }: { params: Promise<{ slug: string }> }) {
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

  const reload = () => fetch(`/api/orgs/${slug}/treasury`).then((r) => r.json()).then((d) => {
    if (d?.org) setOrg({ id: d.org.id, name: d.org.name, vault: d.treasuryVaultAddress, chainId: d.treasuryChainId, owner: d.org.ownerWallet })
  }).catch(() => {})
  useEffect(() => { reload() }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const isOwner = !!(org && address && org.owner.toLowerCase() === address.toLowerCase())

  const { data: usdcAddr } = useReadContract({
    abi: VAULT_ABI, functionName: 'usdc', address: (org?.vault as `0x${string}`) ?? undefined,
    chainId: org?.chainId ?? undefined, query: { enabled: !!org?.vault && !!org?.chainId },
  })

  const record = async () => {
    if (!org || !address) return
    if (!/^0x[a-fA-F0-9]{40}$/.test(recAddr)) return setStatus('Enter a valid vault address.')
    setStatus('Signing…')
    const res = await signedOrgFetch({ path: `/api/orgs/${org.id}/treasury`, action: 'mintware-org-treasury', method: 'PATCH', payload: { treasuryVaultAddress: recAddr, treasuryChainId: recChain }, address, signMessageAsync })
    const d = await res.json()
    setStatus(res.ok ? 'Treasury recorded ✓' : d.error || 'failed')
    if (res.ok) reload()
  }

  const deposit = async (kind: 'senior' | 'junior') => {
    if (!org?.vault || !org.chainId || !address || !usdcAddr) return setStatus('Treasury not ready.')
    const atomic = (() => { try { return parseUnits(amount || '0', 6) } catch { return 0n } })()
    if (atomic <= 0n) return setStatus('Enter a valid amount.')
    try {
      if (walletChain !== org.chainId) { setStatus('Switching chain…'); await switchChainAsync({ chainId: org.chainId }) }
      setStatus('Approve USDC…')
      await writeContractAsync({ abi: ERC20_ABI, address: usdcAddr as `0x${string}`, functionName: 'approve', args: [org.vault as `0x${string}`, atomic], chainId: org.chainId })
      if (kind === 'senior') {
        setStatus('Depositing to treasury (senior)…')
        await writeContractAsync({ abi: VAULT_ABI, address: org.vault as `0x${string}`, functionName: 'depositUSDC', args: [atomic, 0n, address as `0x${string}`], chainId: org.chainId })
        setStatus(`Deposited ${amount} USDC to the treasury ✓`)
      } else {
        setStatus('Committing first-loss (junior)…')
        await writeContractAsync({ abi: VAULT_ABI, address: org.vault as `0x${string}`, functionName: 'commitTeam', args: [0n, atomic, 7776000n], chainId: org.chainId }) // 90-day lock
        setStatus(`Put up ${amount} USDC of first-loss ✓`)
      }
      setAmount(''); reload()
    } catch (e) { setStatus((e as Error)?.message?.slice(0, 140) || 'transaction failed') }
  }

  return (
    <MwAuthGuard>
      <div className="min-h-screen font-atx-display bg-white text-ink">
        <MwNav />
        <main className="mx-auto max-w-[600px] px-6 max-[700px]:px-4 py-[44px]">
          <Link href={`/app/org/${slug}`} className="text-[12.5px] text-peri-deep no-underline hover:underline">← {org?.name || 'Org'}</Link>
          <h1 className="font-atx-display font-semibold text-[26px] tracking-[-0.03em] mt-3">Fund the treasury</h1>

          {org && !org.vault ? (
            <div className="soft-card p-5 mt-6">
              <div className="text-[13.5px] font-semibold text-ink">Record your treasury</div>
              <p className="text-[12.5px] text-ink-mid mt-1.5 leading-[1.5]">The converged vault links an on-chain library, so an operator deploys it once with Foundry, then records the address here:</p>
              <code className="block font-mono text-[11.5px] text-ink-mid bg-ground-cool rounded-[10px] px-3 py-2.5 mt-3 overflow-x-auto whitespace-nowrap">pnpm forge:deploy:treasury-v2:base-sepolia</code>
              {isOwner ? (
                <div className="flex gap-2 mt-4 max-[520px]:flex-col">
                  <input value={recAddr} onChange={(e) => setRecAddr(e.target.value)} placeholder="0x… vault address" className="flex-1 rounded-[10px] border border-hair px-3 py-2.5 text-[13px] font-mono outline-none focus:border-peri" />
                  <select value={recChain} onChange={(e) => setRecChain(Number(e.target.value))} className="rounded-[10px] border border-hair px-3 py-2.5 text-[13px] bg-white outline-none focus:border-peri">{CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  <button onClick={record} className="rounded-full bg-peri text-white px-4 py-2.5 text-[13px] font-semibold hover:bg-peri-deep transition-colors">Record</button>
                </div>
              ) : <p className="text-[12px] text-ink-soft mt-3">Only the org owner can record the treasury.</p>}
            </div>
          ) : org ? (
            <>
              <div className="soft-card p-5 mt-6">
                <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Amount (USDC)</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[15px] tabular-nums outline-none focus:border-peri" />
                </label>
                <div className="flex gap-2 mt-4 max-[520px]:flex-col">
                  <button onClick={() => deposit('senior')} className="flex-1 rounded-full bg-peri text-white px-4 py-3 text-[13.5px] font-semibold hover:bg-peri-deep transition-colors">Deposit to treasury (senior)</button>
                  {isOwner && <button onClick={() => deposit('junior')} className="flex-1 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-4 py-3 text-[13.5px] font-semibold hover:border-peri transition-colors">Put up first-loss (junior)</button>}
                </div>
                <p className="text-[11.5px] text-ink-soft mt-3">Senior deposits stay spendable and redeem at par while the treasury covers them. In a loss event the junior (owner-only) tranche absorbs losses first — first-loss, 90-day lock, and earns the treasury's spread.</p>
              </div>
            </>
          ) : null}

          {status && <div className="mt-4 rounded-[var(--radius-card)] border border-hair bg-ground-cool p-3.5 text-[13px] text-ink">{status}</div>}
        </main>
      </div>
    </MwAuthGuard>
  )
}

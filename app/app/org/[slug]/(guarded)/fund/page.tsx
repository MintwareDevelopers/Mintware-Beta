'use client'

// Treasury yield (renamed from "Savings" — copy rule, 2026-10-02) — a single-asset (USDC) yield account backed by MintwareYieldVault: idle USDC earns in Aave
// via the vault's adapter, a live buffer covers small withdrawals, and redeem() is buffer-first then
// pulls from Aave for the shortfall (large withdrawals stay seamless). No tranches here — that's the
// treasury/Vaults surface. Deposit: approve → deposit(assets, to). Withdraw: redeem(sharesForAmount).
// Chrome comes from the shared TeamTerminalShell layout.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { formatUnits, parseUnits } from 'viem'
import { useAccount, useReadContract, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { PageHead, Kpi, IconGrow } from '@/components/web2/TeamKit'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { YIELD_VAULT_ABI } from '@/lib/web3/artifacts/mintwareYieldVault'

const ERC20_ABI = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const
const CHAINS = [{ id: 84532, name: 'Base Sepolia' }]
const fmtUsd = (atomic?: bigint) => atomic === undefined ? '—' : `$${Number(formatUnits(atomic, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export default function TreasuryYieldPage({ params }: { params: Promise<{ slug: string }> }) {
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

  const { data: usdcAddr }   = useReadContract({ abi: YIELD_VAULT_ABI, functionName: 'asset',       ...readOn })
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
    setStatus(res.ok ? 'Yield vault recorded ✓' : d.error || 'failed')
    if (res.ok) reload()
  }

  const ensureChain = async () => { if (org && walletChain !== org.chainId) { setStatus('Switching chain…'); await switchChainAsync({ chainId: org.chainId! }) } }

  const deposit = async () => {
    if (!vaultAddr || !org?.chainId || !address || !usdcAddr) return setStatus('Treasury yield not ready.')
    const atomic = (() => { try { return parseUnits(amount || '0', 6) } catch { return 0n } })()
    if (atomic <= 0n) return setStatus('Enter a valid amount.')
    try {
      await ensureChain()
      setStatus('Approve USDC…')
      await writeContractAsync({ abi: ERC20_ABI, address: usdcAddr as `0x${string}`, functionName: 'approve', args: [vaultAddr, atomic], chainId: org.chainId })
      setStatus('Supplying…')
      await writeContractAsync({ abi: YIELD_VAULT_ABI, address: vaultAddr, functionName: 'deposit', args: [atomic, address as `0x${string}`], chainId: org.chainId })
      setStatus(`Supplied ${amount} USDC ✓`)
      setAmount(''); refresh()
    } catch (e) { setStatus((e as Error)?.message?.slice(0, 140) || 'transaction failed') }
  }

  const withdraw = async (max = false) => {
    if (!vaultAddr || !org?.chainId || myShares === undefined) return setStatus('Treasury yield not ready.')
    const shares = myShares as bigint
    if (shares <= 0n) return setStatus('Nothing to withdraw.')
    let sharesToBurn = shares
    if (!max) {
      const atomic = (() => { try { return parseUnits(amount || '0', 6) } catch { return 0n } })()
      if (atomic <= 0n) return setStatus('Enter a valid amount.')
      const assets = (myAssets as bigint | undefined) ?? 0n
      if (assets <= 0n) return setStatus('Balance is loading — try again.')
      if (atomic >= assets) sharesToBurn = shares
      else sharesToBurn = (shares * atomic) / assets // exact NAV math; floor keeps it ≤ balance
      if (sharesToBurn <= 0n) return setStatus('Amount too small.')
    }
    try {
      await ensureChain()
      setStatus('Withdrawing (buffer-first)…')
      await writeContractAsync({ abi: YIELD_VAULT_ABI, address: vaultAddr, functionName: 'redeem', args: [sharesToBurn, address as `0x${string}`, address as `0x${string}`], chainId: org.chainId })
      setStatus(max ? 'Withdrew everything ✓' : `Withdrew ${amount} USDC ✓`)
      setAmount(''); refresh()
    } catch (e) { setStatus((e as Error)?.message?.slice(0, 140) || 'transaction failed') }
  }

  return (
    <MwAuthGuard>
      <div className="max-w-[640px] mx-auto">
        <PageHead
          back={{ href: `/app/org/${slug}`, label: org?.name || 'Org' }}
          icon={<IconGrow size={24} />}
          title="Treasury yield"
          status={{ tone: 'building', label: 'Testnet · unaudited' }}
          lede={<>Supply <span className="font-semibold text-ink">USDC</span> to a yield vault. Idle USDC is lent through the vault&apos;s lending adapter, a live buffer covers withdrawals, and larger withdrawals unwind from the adapter on demand. The position is held by <span className="font-semibold text-ink">your connected wallet</span>, not the org address.</>}
        />

        {org && !org.vault ? (
          <div className="mw-raise rounded-[24px] p-6 mt-7">
            <div className="text-[16px] font-semibold text-ink">One-time setup</div>
            <p className="text-[12.5px] text-ink-mid mt-1.5 leading-[1.5]">Treasury yield runs on an on-chain yield vault that&apos;s provisioned once — then you just supply. Today an operator deploys it and records the address below; auto-provisioning is on the roadmap.</p>
            <div className="text-[13px] font-semibold text-ink-mid mt-4 mb-1.5">Operator: deploy once</div>
            <code className="block font-geist-mono text-[12.5px] text-ink-mid rounded-[12px] px-3.5 py-3 overflow-x-auto whitespace-nowrap" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>forge script contracts-v4/script/DeployEarnSepolia.s.sol --rpc-url base_sepolia</code>
            {isOwner ? (
              <div className="flex gap-2 mt-4 max-[520px]:flex-col">
                <input value={recAddr} onChange={(e) => setRecAddr(e.target.value)} placeholder="0x… yield vault address" className="flex-1 rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[13px] font-mono" />
                <select value={recChain} onChange={(e) => setRecChain(Number(e.target.value))} className="rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[13px] bg-white">{CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <button onClick={record} className="mw-btn !min-h-[40px]">Record</button>
              </div>
            ) : <p className="text-[12px] text-ink-soft mt-3">Only the org owner can set up Treasury yield.</p>}
          </div>
        ) : org ? (
          <>
            <div className="grid grid-cols-2 max-[480px]:grid-cols-1 gap-3 mt-7">
              <Kpi k="Your position (your wallet)" v={fmtUsd(myAssets as bigint | undefined)} />
              <Kpi k="Available now" v={fmtUsd(buffer as bigint | undefined)} s="Instant buffer; more unwinds from the lending adapter on demand" />
            </div>

            <div className="mw-raise rounded-[24px] p-6 mt-3">
              <label className="block"><span className="text-[13px] font-semibold text-ink-mid">Amount (USDC)</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1.5 w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[56px] px-4 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[24px] font-geist-mono" />
              </label>
              <div className="flex gap-2 mt-4 max-[520px]:flex-col">
                <button onClick={deposit} className="flex-1 mw-btn !min-h-[48px]">Supply</button>
                <button onClick={() => withdraw(false)} className="flex-1 mw-btn-quiet !min-h-[48px]">Withdraw</button>
              </div>
              <button onClick={() => withdraw(true)} className="text-[13px] text-ink-mid mt-3 bg-transparent border-0 cursor-pointer hover:text-ink">Withdraw all →</button>
              <p className="text-[12.5px] text-ink-soft mt-3 leading-[1.5]">Supplied USDC earns whatever the vault&apos;s lending adapter pays. The rate varies, isn&apos;t guaranteed, and is zero when a vault uses a no-yield adapter, as some testnet vaults do. Withdrawals come from the buffer first, then the adapter. There&apos;s no lockup, but a large exit can wait on the adapter&apos;s liquidity. Testnet only.</p>
            </div>
          </>
        ) : null}

        {status && <div role="status" className="mt-4 rounded-[16px] px-4 py-3 text-[14px] text-ink" style={{ background: 'var(--mw-band)' }}>{status}</div>}
      </div>
    </MwAuthGuard>
  )
}

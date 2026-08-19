'use client'

// Set up your treasury multisig (P3 L2, in-app) — owner-only. Pick which of your team's wallets are
// signers (Privy embedded wallets = passkey signers, no MetaMask) and a threshold, deploy a Gnosis Safe
// from the browser via the canonical 1.4.1 factory, then transfer the treasury vault's ownership to it.
// After this, every config / large-withdrawal action requires M-of-N approval. No Safe app, no script.

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAccount, usePublicClient, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { type Address } from 'viem'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import {
  SAFE_FACTORY_ABI, VAULT_OWNABLE_ABI, buildSafeInitializer, safeAddressFromLogs, safeContractsFor,
} from '@/lib/org/safeDeploy'

interface Member { wallet: string | null; role: string; status: string }
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default function MultisigSetup({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address } = useMintwareIdentity()
  const { chainId: walletChain } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [org, setOrg] = useState<{ id: string; name: string; ownerWallet: string; vault: string | null; chainId: number | null; alreadyMultisig: boolean } | null>(null)
  const [signers, setSigners] = useState<string[]>([])
  const [threshold, setThreshold] = useState(2)
  const [status, setStatus] = useState('')
  const [safeAddr, setSafeAddr] = useState<Address | null>(null)
  const [done, setDone] = useState(false)

  const pc = usePublicClient({ chainId: org?.chainId ?? undefined })
  const isOwner = !!(address && org && address.toLowerCase() === org.ownerWallet.toLowerCase())

  // Load org + treasury (owner, vault, chain, whether already a multisig).
  useEffect(() => {
    const q = address ? `?address=${address}` : ''
    fetch(`/api/orgs/${slug}/treasury${q}`).then((r) => r.json()).then((d) => {
      if (d?.org) setOrg({
        id: d.org.id, name: d.org.name, ownerWallet: d.org.ownerWallet,
        vault: d.treasuryVaultAddress ?? null, chainId: d.treasuryChainId ?? null,
        alreadyMultisig: !!d.control?.multisig,
      })
    }).catch(() => {})
  }, [slug, address])

  // Seed signers = owner + active members with wallets (deduped).
  const seedSigners = useCallback(async () => {
    if (!org || !address) return
    const base = [org.ownerWallet.toLowerCase()]
    const res = await signedOrgFetch({ path: `/api/orgs/${org.id}/members`, action: 'mintware-org-members', method: 'POST', address, signMessageAsync }).catch(() => null)
    if (res && res.ok) {
      const d = await res.json()
      for (const m of (d.members as Member[]) ?? []) {
        if (m.wallet && m.status === 'active') base.push(m.wallet.toLowerCase())
      }
    }
    const uniq = Array.from(new Set(base))
    setSigners(uniq)
    setThreshold(Math.max(1, Math.ceil(uniq.length / 2))) // sensible default: majority
  }, [org, address, signMessageAsync])
  useEffect(() => { if (org && isOwner) void seedSigners() }, [org, isOwner, seedSigners])

  const canDeploy = useMemo(() => signers.length >= 1 && threshold >= 1 && threshold <= signers.length && !!org?.chainId, [signers, threshold, org])

  async function deploy() {
    if (!org?.chainId || !canDeploy) return
    const safeCfg = safeContractsFor(org.chainId)
    if (!safeCfg) { setStatus('Safe isn’t available on this chain yet.'); return }
    try {
      if (walletChain !== org.chainId) { setStatus('Switching chain…'); await switchChainAsync({ chainId: org.chainId }) }
      setStatus('Deploying your multisig…')
      const initializer = buildSafeInitializer(signers as Address[], threshold)
      const hash = await writeContractAsync({
        abi: SAFE_FACTORY_ABI, address: safeCfg.proxyFactory, functionName: 'createProxyWithNonce',
        args: [safeCfg.singleton, initializer, BigInt(Date.now())], chainId: org.chainId,
      })
      setStatus('Confirming deployment…')
      const receipt = await pc!.waitForTransactionReceipt({ hash })
      const addr = safeAddressFromLogs(receipt.logs)
      if (!addr) { setStatus('Deployed, but couldn’t read the Safe address — check the tx.'); return }
      setSafeAddr(addr)
      setStatus(`Multisig deployed: ${short(addr)}. Now transfer the treasury to it.`)
    } catch (e) {
      setStatus(`Deploy failed: ${(e as Error).message?.slice(0, 120) ?? 'error'}`)
    }
  }

  async function transfer() {
    if (!safeAddr || !org?.vault || !org.chainId) return
    try {
      if (walletChain !== org.chainId) await switchChainAsync({ chainId: org.chainId })
      setStatus('Transferring treasury ownership to the multisig…')
      const hash = await writeContractAsync({
        abi: VAULT_OWNABLE_ABI, address: org.vault as Address, functionName: 'transferOwnership',
        args: [safeAddr], chainId: org.chainId,
      })
      await pc!.waitForTransactionReceipt({ hash })
      setDone(true)
      setStatus('Done — your treasury is now behind the multisig.')
    } catch (e) {
      setStatus(`Transfer failed: ${(e as Error).message?.slice(0, 120) ?? 'error'}`)
    }
  }

  return (
    <MwAuthGuard>
      <div className="min-h-screen bg-white font-atx-display text-ink">
        <MwNav />
        <main className="mx-auto max-w-[720px] px-6 max-[700px]:px-4 py-[44px]">
          <Link href={`/app/org/${slug}/control`} className="text-[13px] text-ink-soft hover:text-ink no-underline">← Treasury control</Link>
          <h1 className="font-atx-display font-semibold text-[clamp(1.6rem,3.4vw,2rem)] tracking-[-0.03em] mt-2">Set up your <span className="text-gradient-accent">multisig</span></h1>
          <p className="text-ink-mid text-[14px] leading-[1.55] max-w-[62ch] mt-2.5">
            Put your treasury behind an M-of-N Gnosis Safe. Signers are your team&apos;s Privy wallets —
            each approves with a passkey. No MetaMask, no Safe app, no script.
          </p>

          {!isOwner ? (
            <div className="soft-card p-6 mt-6 text-[14px] text-ink-mid">Only the org owner can set up the treasury multisig.</div>
          ) : org?.alreadyMultisig ? (
            <div className="soft-card p-6 mt-6"><div className="live-chip"><span className="dot" aria-hidden />Already a multisig</div><p className="text-[13.5px] text-ink-mid mt-2">Your treasury is already owned by a multisig. <Link href={`/app/org/${slug}/control`} className="text-peri-deep no-underline hover:underline">View control →</Link></p></div>
          ) : !org?.vault ? (
            <div className="soft-card p-6 mt-6 text-[14px] text-ink-mid">Deploy + record your treasury first, then secure it with a multisig. <Link href={`/app/org/${slug}/fund`} className="text-peri-deep no-underline hover:underline">Set up treasury →</Link></div>
          ) : (
            <>
              {/* Signers */}
              <section className="soft-card p-6 mt-6">
                <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Signers</div>
                <p className="text-[12.5px] text-ink-soft mt-1.5">Your active team wallets. Toggle who can approve; the owner is always a signer.</p>
                <div className="mt-3 flex flex-col gap-2">
                  {signers.map((s) => {
                    const locked = s === org.ownerWallet.toLowerCase()
                    return (
                      <label key={s} className={`flex items-center gap-3 rounded-[10px] border border-hair px-3 py-2.5 text-[13px] ${locked ? 'bg-ground-cool' : 'cursor-pointer hover:bg-ground-cool'}`}>
                        <input type="checkbox" checked disabled={locked} onChange={() => { if (!locked) setSigners((p) => p.filter((x) => x !== s)) }} />
                        <span className="font-mono text-[12.5px]">{short(s)}</span>
                        {locked && <span className="text-[10px] uppercase tracking-[0.06em] font-semibold text-peri-deep">Owner</span>}
                      </label>
                    )
                  })}
                </div>
                <div className="mt-4 flex items-center gap-3 flex-wrap">
                  <span className="text-[13px] text-ink-mid">Approvals required</span>
                  <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="rounded-lg border border-hair bg-white px-3 py-1.5 text-[13px]">
                    {Array.from({ length: signers.length }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} of {signers.length}</option>)}
                  </select>
                </div>
              </section>

              {/* Actions */}
              <section className="mt-4 flex flex-col gap-3">
                {!safeAddr ? (
                  <button onClick={deploy} disabled={!canDeploy} className="rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50 self-start">Deploy {threshold}-of-{signers.length} multisig</button>
                ) : !done ? (
                  <button onClick={transfer} className="rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors self-start">Transfer treasury to the multisig →</button>
                ) : (
                  <Link href={`/app/org/${slug}/control`} className="rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold no-underline hover:bg-peri-deep transition-colors self-start">View control →</Link>
                )}
                {status && <div className="text-[13px] text-ink-mid font-mono">{status}</div>}
                {safeAddr && <div className="text-[12px] text-ink-soft font-mono">Safe: {safeAddr}</div>}
              </section>
            </>
          )}
        </main>
      </div>
    </MwAuthGuard>
  )
}

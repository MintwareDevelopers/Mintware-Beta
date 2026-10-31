'use client'

// Set up your treasury multisig (P3 L2, in-app) — owner-only. Pick which of your team's wallets are
// signers (Privy embedded wallets = passkey signers, no MetaMask) and a threshold, deploy a Gnosis Safe
// from the browser via the canonical 1.4.1 factory, then transfer the treasury vault's ownership to it.
// After this, every config / large-withdrawal action requires M-of-N approval. No Safe app, no script.
// Chrome comes from the shared TeamTerminalShell layout.

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAccount, usePublicClient, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { type Address } from 'viem'
import { PageHead, StatusChip, IconShield } from '@/components/web2/TeamKit'
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
  const isOwner = !!(address && org && address.toLowerCase() === org.ownerWallet?.toLowerCase())

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
    const base = [org.ownerWallet?.toLowerCase() ?? '']
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
      <div className="max-w-[720px] mx-auto">
        <PageHead
          back={{ href: `/app/org/${slug}/control`, label: 'Treasury control' }}
          icon={<IconShield size={24} />}
          title="Set up your multisig"
          lede="Put your treasury behind an M-of-N Gnosis Safe in two steps: deploy it, then hand the treasury to it. Signers are your team's Privy wallets, each approving with a passkey."
        />

        {!isOwner ? (
          <div className="mw-inset rounded-[20px] p-6 mt-7 text-[14px] text-ink-mid">Only the org owner can set up the treasury multisig.</div>
        ) : org?.alreadyMultisig ? (
          <div className="mw-raise rounded-[24px] p-6 mt-7"><StatusChip tone="live">Already a multisig</StatusChip><p className="text-[14px] text-ink-mid mt-3">Your treasury is already owned by a multisig. <Link href={`/app/org/${slug}/control`} className="text-peri-deep no-underline hover:underline">View control →</Link></p></div>
        ) : !org?.vault ? (
          <div className="mw-inset rounded-[20px] p-6 mt-7 text-[14px] text-ink-mid">Set up your treasury first (start with Treasury yield), then secure it with a multisig. <Link href={`/app/org/${slug}`} className="text-peri-deep no-underline hover:underline">Open treasury →</Link></div>
        ) : (
          <>
            {/* Signers */}
            <section className="mw-raise rounded-[24px] p-6 mt-7">
              <div className="text-[16px] font-semibold text-ink">Signers</div>
              <p className="text-[13.5px] text-ink-mid mt-1">Your active team wallets. Untick anyone who shouldn&apos;t approve; the owner is always a signer.</p>
              <div className="mt-3 flex flex-col gap-2">
                {signers.map((s) => {
                  const locked = s === org.ownerWallet?.toLowerCase()
                  return (
                    <label key={s} className={`flex items-center gap-3 rounded-[12px] px-3.5 min-h-[46px] text-[14px] ${locked ? '' : 'cursor-pointer'}`} style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                      <input type="checkbox" className="accent-[#5B5BE6] w-4 h-4" checked disabled={locked} onChange={() => { if (!locked) setSigners((p) => p.filter((x) => x !== s)) }} />
                      <span className="font-geist-mono text-[13.5px]">{short(s)}</span>
                      {locked && <StatusChip tone="muted" className="ml-auto">Owner</StatusChip>}
                    </label>
                  )
                })}
              </div>
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <span className="text-[14px] font-semibold text-ink-mid">Approvals required</span>
                <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px] !w-auto">
                  {Array.from({ length: signers.length }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} of {signers.length}</option>)}
                </select>
              </div>
            </section>

            {/* Actions */}
            {/* Two steps, shown as a pair so the owner knows the deploy isn't the end. */}
            <ol className="mt-4 p-0 list-none grid grid-cols-2 max-[520px]:grid-cols-1 gap-3" aria-label="Setup steps">
              {([['Deploy the Safe', !!safeAddr], ['Transfer the treasury to it', done]] as [string, boolean][]).map(([t, ok], i) => (
                <li key={t} className={`rounded-[16px] px-4 py-3 flex items-center gap-3 text-[14px] ${ok ? 'mw-raise-sm' : 'mw-inset'}`}>
                  <span className={`w-7 h-7 rounded-full grid place-items-center text-[12.5px] font-semibold shrink-0 ${ok ? 'text-white' : 'text-ink-mid'}`} style={{ background: ok ? '#0F7A43' : '#fff' }}>{ok ? '✓' : i + 1}</span>
                  <span className={ok ? 'font-semibold' : 'text-ink-mid'}>{t}</span>
                </li>
              ))}
            </ol>
            <section className="mt-4 flex flex-col gap-3">
              {!safeAddr ? (
                <button onClick={deploy} disabled={!canDeploy} className="mw-btn !min-h-[48px] disabled:opacity-50 self-start">Deploy {threshold}-of-{signers.length} multisig</button>
              ) : !done ? (
                <button onClick={transfer} className="mw-btn !min-h-[48px] self-start">Transfer treasury to the multisig →</button>
              ) : (
                <Link href={`/app/org/${slug}/control`} className="mw-btn !min-h-[48px] no-underline  self-start">View control →</Link>
              )}
              {status && <div role="status" className="rounded-[14px] px-4 py-3 text-[13.5px] text-ink" style={{ background: 'var(--mw-band)' }}>{status}</div>}
              {safeAddr && <div className="text-[13px] text-ink-soft font-geist-mono break-all">Safe: {safeAddr}</div>}
            </section>
          </>
        )}
      </div>
    </MwAuthGuard>
  )
}

'use client'

// Accept an invitation. PUBLIC (no auth guard — the invitee lands here logged-out). Reads ?email from the
// invite link, prompts Privy email login, then claims the pending invite → wallet attached + OrgMembership
// EAS attestation minted (POST /api/orgs/accept). Closes the loop: create → invite-link → accept → member.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePrivy } from '@privy-io/react-auth'
import { useSignMessage } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MintwareMark } from '@/components/ui2/MintwareMark'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'

export default function AcceptPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address, isConnected } = useMintwareIdentity()
  const { login } = usePrivy()
  const { signMessageAsync } = useSignMessage()
  const [email, setEmail] = useState('')
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null)
  const [state, setState] = useState<'idle' | 'accepting' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  // email from the invite link
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('email')
    if (e) setEmail(e.toLowerCase())
  }, [])
  // resolve slug -> org
  useEffect(() => {
    fetch(`/api/orgs/${slug}/treasury`).then((r) => r.json()).then((d) => { if (d?.org) setOrg({ id: d.org.id, name: d.org.name }) }).catch(() => {})
  }, [slug])

  const accept = useCallback(async () => {
    if (!org || !address || !email) return
    setState('accepting'); setMsg('')
    try {
      const res = await signedOrgFetch({ path: '/api/orgs/accept', action: 'mintware-org-accept', payload: { org_id: org.id, email }, address, signMessageAsync })
      const d = await res.json()
      if (res.ok) { setState('done') }
      else { setState('error'); setMsg(d.error ?? 'Could not accept — is this the email the invite was sent to?') }
    } catch (e) { setState('error'); setMsg((e as Error)?.message ?? String(e)) }
  }, [org, address, email, signMessageAsync])

  return (
    <div className="min-h-screen font-atx-display bg-white text-ink">
      <MwNav />
      <main className="mx-auto max-w-[480px] px-6 max-[700px]:px-4 py-[64px]">
        <div className="soft-card p-6 text-center">
          <MintwareMark className="w-[30px] h-[30px] mx-auto" />
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep mt-4">You're invited</div>
          <h1 className="font-atx-display font-semibold text-[24px] tracking-[-0.03em] mt-1.5">Join {org?.name ?? 'the org'}</h1>

          {state === 'done' ? (
            <div className="mt-5">
              <div className="inline-flex items-center gap-2 text-mw-green font-semibold text-[15px]"><span className="w-[9px] h-[9px] rounded-full bg-mw-green" />You're in — attested on-chain ✓</div>
              <p className="text-[13px] text-ink-mid mt-2">Your wallet is now a member with a spendable balance.</p>
              <Link href={`/app/org/${slug}`} className="mt-5 inline-block rounded-full bg-peri text-white px-5 py-2.5 text-[13.5px] font-semibold no-underline hover:bg-peri-deep transition-colors">Open your org →</Link>
            </div>
          ) : !isConnected ? (
            <div className="mt-5">
              <p className="text-[13px] text-ink-mid leading-[1.5]">Sign in with <span className="text-ink font-medium">{email || 'the email this invite was sent to'}</span> to claim your membership.</p>
              <button onClick={() => login({ loginMethods: ['email', 'wallet'], walletChainType: 'ethereum-only' })} className="mt-4 rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors">Sign in to accept</button>
            </div>
          ) : (
            <div className="mt-5">
              {!email && (
                <label className="block text-left mb-3"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Your invited email</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} placeholder="you@org.xyz" className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] outline-none focus:border-peri" />
                </label>
              )}
              <button onClick={accept} disabled={state === 'accepting' || !email} className="rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">
                {state === 'accepting' ? 'Signing + attesting…' : 'Accept invitation'}
              </button>
              {state === 'error' && <p className="text-[12.5px] text-ink-mid mt-3">{msg}</p>}
            </div>
          )}
        </div>
        <p className="text-[11.5px] text-ink-soft text-center mt-5">Accepting mints a soulbound OrgMembership attestation to your wallet. Testnet-only, unaudited.</p>
      </main>
    </div>
  )
}

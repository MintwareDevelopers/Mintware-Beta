'use client'
// Accept an invitation. PUBLIC (no auth guard — the invitee lands here logged-out). Reads ?email from the
// invite link, shows WHAT they're joining (org · role · card · spend cap), prompts Privy login, then claims
// the pending invite → wallet attached + OrgMembership EAS attestation minted (POST /api/orgs/accept).
// On success it persists team mode + routes to the org so a returning cardholder is never orphaned.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePrivy } from '@privy-io/react-auth'
import { useSignMessage } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MintwareMark } from '@/components/ui2/MintwareMark'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { policyForRole } from '@/lib/org/rolePresets'
import { persistAppMode } from '@/components/web2/AppMode'

function capLabel(role: string | null): string {
  const cap = policyForRole(role ?? 'contributor').dailyCapUsdc
  if (cap === null) return 'No spend cap'
  if (cap === 0n) return 'Receive-only — gets paid, cannot spend'
  return `Up to $${Number(cap / 1_000_000n).toLocaleString()} / day`
}

export default function AcceptPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address, isConnected } = useMintwareIdentity()
  const { login } = usePrivy()
  const { signMessageAsync } = useSignMessage()
  const [email, setEmail] = useState('')
  const [invite, setInvite] = useState<{ id: string; name: string; role: string | null } | null>(null)
  const [state, setState] = useState<'idle' | 'accepting' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('email')
    if (e) setEmail(e.toLowerCase())
  }, [])

  // Resolve org + the pending role for this email in one call (public pre-login peek).
  useEffect(() => {
    const q = email ? `?email=${encodeURIComponent(email)}` : ''
    fetch(`/api/orgs/${slug}/invite${q}`).then((r) => r.json()).then((d) => {
      if (d?.orgId) setInvite({ id: d.orgId, name: d.orgName, role: d.role })
    }).catch(() => {})
  }, [slug, email])

  const role = invite?.role ?? 'contributor'
  const roleLabel = policyForRole(role).label
  const isVendor = policyForRole(role).dailyCapUsdc === 0n

  const accept = useCallback(async () => {
    if (!invite || !address || !email) return
    setState('accepting'); setMsg('')
    try {
      const res = await signedOrgFetch({ path: '/api/orgs/accept', action: 'mintware-org-accept', payload: { org_id: invite.id, email }, address, signMessageAsync })
      const d = await res.json()
      if (res.ok) { persistAppMode('team'); setState('done') }
      else { setState('error'); setMsg(d.error ?? 'Could not accept — is this the email the invite was sent to?') }
    } catch (e) { setState('error'); setMsg((e as Error)?.message ?? String(e)) }
  }, [invite, address, email, signMessageAsync])

  return (
    <div className="min-h-screen font-atx-display bg-white text-ink">
      <MwNav />
      <main className="mx-auto max-w-[460px] px-6 max-[700px]:px-4 py-[64px]">
        <div className="soft-card p-6 text-center">
          <MintwareMark className="w-[30px] h-[30px] mx-auto" />
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep mt-4">{invite?.name || 'A team'} invited you</div>
          <h1 className="font-atx-display font-semibold text-[24px] tracking-[-0.03em] mt-1.5">Join {invite?.name ?? 'the team'} on Mintware</h1>

          {state === 'done' ? (
            <div className="mt-5">
              <div className="inline-flex items-center gap-2 text-mw-green font-semibold text-[15px]"><span className="w-[9px] h-[9px] rounded-full bg-mw-green" />You're in — attested on-chain ✓</div>
              <p className="text-[13px] text-ink-mid mt-2">Your wallet is a member of {invite?.name ?? 'the team'}{isVendor ? '' : ', with a card to spend from their treasury'}.</p>
              <Link href={`/app/org/${slug}`} className="mt-5 inline-block rounded-full bg-peri text-white px-5 py-2.5 text-[13.5px] font-semibold no-underline hover:bg-peri-deep transition-colors">{isVendor ? 'Open your org →' : 'Go to your card →'}</Link>
            </div>
          ) : (
            <>
              {/* What you get — role, card, cap. This is what makes the invite land. */}
              <div className="soft-card bg-ground-cool p-4 mt-5 text-left flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5"><span className="text-ink-soft">◈</span><span className="text-[13px] text-ink">Your role · <span className="font-semibold">{roleLabel}</span></span></div>
                {!isVendor && <div className="flex items-center gap-2.5"><span className="text-ink-soft">▤</span><span className="text-[13px] text-ink">A card to spend from their treasury</span></div>}
                <div className="flex items-center gap-2.5"><span className="text-ink-soft">◆</span><span className="text-[13px] text-ink">{capLabel(role)}</span></div>
              </div>

              {!isConnected ? (
                <div className="mt-5">
                  <button onClick={() => login({ loginMethods: ['email', 'wallet'], walletChainType: 'ethereum-only' })} className="w-full rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors">Sign in to accept</button>
                  <p className="text-[12px] text-ink-soft mt-2.5">{email ? `with ${email} — the email this invite was sent to` : 'with the email this invite was sent to'}</p>
                </div>
              ) : (
                <div className="mt-5">
                  {!email && (
                    <label className="block text-left mb-3"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Your invited email</span>
                      <input value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} placeholder="you@team.xyz" className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] outline-none focus:border-peri" />
                    </label>
                  )}
                  <button onClick={accept} disabled={state === 'accepting' || !email} className="w-full rounded-full bg-peri text-white px-5 py-3 text-[14px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">
                    {state === 'accepting' ? 'Signing + attesting…' : 'Accept invitation'}
                  </button>
                  {state === 'error' && <p className="text-[12.5px] text-ink-mid mt-3">{msg}</p>}
                </div>
              )}
            </>
          )}
        </div>
        <p className="text-[11.5px] text-ink-soft text-center mt-5">Accepting mints a soulbound OrgMembership attestation to your wallet. Testnet-only, unaudited.</p>
      </main>
    </div>
  )
}

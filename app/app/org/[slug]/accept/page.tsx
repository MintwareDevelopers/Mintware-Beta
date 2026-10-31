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
import { StatusChip, FIELD } from '@/components/web2/TeamKit'

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
    <div className="min-h-screen font-geist text-ink" style={{ background: 'var(--mw-ground)' }}>
      <MwNav />
      <main className="mx-auto max-w-[460px] px-6 max-[700px]:px-4 py-[64px]">
        <div className="mw-raise-lg relative overflow-hidden rounded-[28px] p-7 text-center">
          <div aria-hidden className="absolute -right-20 -top-24 w-64 h-64 rounded-full opacity-30 blur-[50px]" style={{ background: 'var(--mw-sheen)' }} />
          <MintwareMark size={40} className="relative block mx-auto" />
          <div className="relative text-[13px] font-semibold uppercase tracking-[0.08em] mt-4" style={{ color: 'var(--mw-peri-deep)' }}>{invite?.name || 'A team'} invited you</div>
          <h1 className="relative font-semibold text-[28px] tracking-[-0.035em] leading-[1.1] mt-2">Join {invite?.name ?? 'the team'} on Mintware</h1>

          {state === 'done' ? (
            <div className="relative mt-6">
              <StatusChip tone="live">You&apos;re in · attested on-chain</StatusChip>
              <p className="text-[14px] text-ink-mid mt-3">Your wallet is now a member of {invite?.name ?? 'the team'}.</p>
              <Link href={`/app/org/${slug}`} className="mt-5 mw-btn !min-h-[44px]">Open your org</Link>
            </div>
          ) : (
            <>
              {/* What you get — role, card, cap. This is what makes the invite land. */}
              <ul className="relative mt-6 p-0 list-none text-left flex flex-col gap-2">
                <li className="flex items-center gap-3 rounded-[14px] px-4 py-3 text-[14px]" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}><span className="text-ink-soft w-[88px] shrink-0">Your role</span><span className="font-semibold">{roleLabel}</span></li>
                <li className="flex items-center gap-3 rounded-[14px] px-4 py-3 text-[14px]" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}><span className="text-ink-soft w-[88px] shrink-0">Spend cap</span><span className="font-geist-mono text-[13.5px]">{capLabel(role)}</span></li>
                {!isVendor && <li className="flex items-center gap-3 rounded-[14px] px-4 py-3 text-[14px]" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}><span className="text-ink-soft w-[88px] shrink-0">Card</span><span className="flex items-center gap-2 flex-wrap">A team card, once cards launch <StatusChip tone="building">Not live yet</StatusChip></span></li>}
              </ul>

              {!isConnected ? (
                <div className="relative mt-6">
                  <button onClick={() => login({ loginMethods: ['email', 'wallet'], walletChainType: 'ethereum-only' })} className="w-full mw-btn !min-h-[48px]">Sign in to accept</button>
                  <p className="text-[13px] text-ink-soft mt-3">{email ? `with ${email} — the email this invite was sent to` : 'with the email this invite was sent to'}</p>
                </div>
              ) : (
                <div className="relative mt-6">
                  {!email && (
                    <label className="block text-left mb-3"><span className="text-[13px] font-semibold text-ink-mid">Your invited email</span>
                      <input value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} placeholder="you@team.xyz" className="mt-1.5 w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px]" />
                    </label>
                  )}
                  <button onClick={accept} disabled={state === 'accepting' || !email} className="w-full mw-btn !min-h-[48px] disabled:opacity-50">
                    {state === 'accepting' ? 'Signing + attesting…' : 'Accept invitation'}
                  </button>
                  {state === 'error' && <p role="status" className="mt-3 rounded-[14px] bg-[#FBE9E7] px-4 py-3 text-[13.5px] text-[#B42318]">{msg}</p>}
                </div>
              )}
            </>
          )}
        </div>
        <p className="text-[12.5px] text-ink-soft text-center mt-5">Accepting mints a soulbound OrgMembership attestation to your wallet. Testnet-only, unaudited.</p>
      </main>
    </div>
  )
}

'use client'

// Members & roles (#3) — the roster with an invite form and a four-preset dropdown per member. NOT a
// policy engine: "role" is just one of owner/manager/contributor/vendor, each a canned cap. Owner-only.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { ROLE_PRESET_LIST, type RolePreset } from '@/lib/org/rolePresets'

interface Member { id: string; invited_email: string | null; wallet: string | null; role: string; status: string; eas_uid: string | null }

export default function RolesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address } = useMintwareIdentity()
  const { signMessageAsync } = useSignMessage()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<RolePreset>('contributor')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [lastLink, setLastLink] = useState<{ email: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Resolve slug -> org id + name (public treasury read).
  useEffect(() => {
    fetch(`/api/orgs/${slug}/treasury`).then((r) => r.json()).then((d) => {
      if (d?.org) { setOrgId(d.org.id); setOrgName(d.org.name) }
    }).catch(() => {})
  }, [slug])

  // Roster read = signed POST (owner-only, includes emails).
  const refresh = useCallback(async () => {
    if (!orgId || !address) return
    const res = await signedOrgFetch({ path: `/api/orgs/${orgId}/members`, action: 'mintware-org-members', method: 'POST', address, signMessageAsync }).catch(() => null)
    if (res && res.ok) { const d = await res.json(); if (Array.isArray(d.members)) setMembers(d.members) }
  }, [orgId, address, signMessageAsync])
  useEffect(() => { void refresh() }, [refresh])

  const invite = async () => {
    if (!orgId || !address || !email) return
    setBusy('invite'); setMsg('')
    try {
      const res = await signedOrgFetch({ path: `/api/orgs/${orgId}/invite`, action: 'mintware-org-invite', payload: { email, role: inviteRole }, address, signMessageAsync })
      const d = await res.json()
      if (res.ok) {
        const url = `${window.location.origin}/app/org/${slug}/accept?email=${encodeURIComponent(email)}`
        setLastLink({ email, url }); setCopied(false); setMsg(''); setEmail(''); refresh()
      } else setMsg(d.error ?? 'invite failed')
    } catch (e) { setMsg(String(e)) } finally { setBusy('') }
  }

  const setRole = async (memberId: string, role: RolePreset) => {
    if (!orgId || !address) return
    setBusy(memberId)
    try {
      const res = await signedOrgFetch({ path: `/api/orgs/${orgId}/members`, action: 'mintware-org-members', method: 'PATCH', payload: { memberId, role }, address, signMessageAsync })
      if (res.ok) refresh(); else { const d = await res.json(); setMsg(d.error ?? 'failed') }
    } finally { setBusy('') }
  }

  return (
    <MwAuthGuard>
      <div className="min-h-screen font-atx-display bg-white text-ink">
        <MwNav />
        <main className="mx-auto max-w-[900px] px-6 max-[700px]:px-4 py-[44px]">
          <Link href={`/app/org/${slug}`} className="text-[12.5px] text-peri-deep no-underline hover:underline">← {orgName || 'Org'}</Link>
          <h1 className="font-atx-display font-semibold text-[26px] tracking-[-0.03em] mt-3">Members &amp; roles</h1>
          <p className="text-[13px] text-ink-mid mt-1.5 max-w-[64ch]">Invite by email; when they sign in, their wallet is attested as an OrgMembership on-chain. Each role is a fixed spend preset — pick from four.</p>

          {/* Next step in the flow: once teammates accept, secure the treasury with them as signers. */}
          <Link href={`/app/org/${slug}/control/setup`} className="mt-4 flex items-center justify-between gap-3 rounded-[12px] border border-[rgba(108,108,240,0.3)] px-4 py-3 no-underline hover:bg-ground-cool transition-colors" style={{ background: 'linear-gradient(120deg, rgba(108,108,240,0.06), transparent)' }}>
            <span className="text-[13px] text-ink-mid"><b className="text-ink">Secure the treasury with these people.</b> Once they&apos;ve accepted, set up an M-of-N multisig — they become your passkey signers.</span>
            <span className="text-peri-deep font-semibold text-[13px] shrink-0">Set up multisig →</span>
          </Link>

          {/* invite */}
          <div className="soft-card p-5 mt-6 flex items-end gap-3 max-[640px]:flex-col max-[640px]:items-stretch">
            <label className="flex-1 block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Invite email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@org.xyz" className="mt-1.5 w-full rounded-[10px] border border-hair px-3 py-2.5 text-[14px] outline-none focus:border-peri" />
            </label>
            <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Role</span>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as RolePreset)} className="mt-1.5 rounded-[10px] border border-hair px-3 py-2.5 text-[14px] outline-none focus:border-peri bg-white">
                {ROLE_PRESET_LIST.map((p) => <option key={p.preset} value={p.preset}>{p.label}</option>)}
              </select>
            </label>
            <button onClick={invite} disabled={busy === 'invite' || !email} className="rounded-full bg-peri text-white px-5 py-2.5 text-[13px] font-semibold hover:bg-peri-deep transition-colors disabled:opacity-50">{busy === 'invite' ? 'Signing…' : 'Invite'}</button>
          </div>
          {msg && <div className="text-[12.5px] text-ink-mid mt-3">{msg}</div>}
          {lastLink && (
            <div className="soft-card p-4 mt-3 border border-[rgba(108,108,240,0.25)]">
              <div className="text-[12.5px] text-ink"><span className="font-semibold">{lastLink.email}</span> invited. Send them this link to accept — sign-in is gated to their email, and accepting mints their membership.</div>
              <div className="flex items-center gap-2 mt-2.5 max-[560px]:flex-col max-[560px]:items-stretch">
                <code className="flex-1 font-mono text-[11.5px] text-ink-mid bg-ground-cool rounded-[10px] px-3 py-2 overflow-x-auto whitespace-nowrap">{lastLink.url}</code>
                <button onClick={() => { navigator.clipboard?.writeText(lastLink.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }} className="shrink-0 rounded-full bg-peri text-white px-4 py-2 text-[12.5px] font-semibold hover:bg-peri-deep transition-colors">{copied ? 'Copied ✓' : 'Copy link'}</button>
              </div>
              <div className="text-[11px] text-ink-soft mt-2">No email is sent automatically — share the link however you like (email, Slack, DM).</div>
            </div>
          )}

          {/* roster */}
          <div className="soft-card mt-4 overflow-hidden">
            {members.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-ink-soft">No members yet — invite your first teammate.</div>}
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-hair-soft last:border-b-0 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-medium text-ink truncate">{m.wallet ? `${m.wallet.slice(0, 6)}…${m.wallet.slice(-4)}` : m.invited_email}</div>
                  <div className="text-[11.5px] text-ink-soft">{m.status}{m.eas_uid ? ' · attested ✓' : ''}</div>
                </div>
                <select value={(m.role || 'contributor') as RolePreset} onChange={(e) => setRole(m.id, e.target.value as RolePreset)} disabled={busy === m.id}
                  className="rounded-[10px] border border-hair px-3 py-2 text-[13px] bg-white outline-none focus:border-peri disabled:opacity-50">
                  {ROLE_PRESET_LIST.map((p) => <option key={p.preset} value={p.preset}>{p.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </main>
      </div>
    </MwAuthGuard>
  )
}

'use client'

// Members & roles (#3) — the roster with an invite form and a four-preset dropdown per member. NOT a
// policy engine: "role" is just one of owner/manager/contributor/vendor, each a canned cap. Owner-only.
// Chrome comes from the shared TeamTerminalShell layout — this is the real "Team & Roles."

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { PageHead, SLabel, StatusChip, IconTile, IconPeople, IconShield } from '@/components/web2/TeamKit'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { ROLE_PRESET_LIST, type RolePreset } from '@/lib/org/rolePresets'

interface Member { id: string; invited_email: string | null; wallet: string | null; role: string; status: string; eas_uid: string | null }

const capText = (c: bigint | null): string => c === null ? 'No spend cap' : c === 0n ? 'Receive-only' : `$${(Number(c) / 1e6).toLocaleString()}/day`

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
  const [ownerWallet, setOwnerWallet] = useState<string | null>(null)

  // Resolve slug -> org id + name. Pass ?address so the treasury read returns ownerWallet to the owner
  // (gated to owner/members server-side) — lets us hide the owner-only invite/role controls from others.
  useEffect(() => {
    const q = address ? `?address=${address}` : ''
    fetch(`/api/orgs/${slug}/treasury${q}`).then((r) => r.json()).then((d) => {
      if (d?.org) { setOrgId(d.org.id); setOrgName(d.org.name); setOwnerWallet(d.org.ownerWallet ?? null) }
    }).catch(() => {})
  }, [slug, address])

  const isOwner = !!(address && ownerWallet && address.toLowerCase() === ownerWallet.toLowerCase())

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
      <div className="max-w-[900px] mx-auto">
        <PageHead
          back={{ href: `/app/org/${slug}`, label: orgName || 'Org' }}
          icon={<IconPeople size={24} />}
          title="Members & roles"
          lede="Invite by email and pick a role. When they sign in, their wallet is attested as an OrgMembership on-chain. Each role is a fixed spend preset."
        />

        {/* invite — owner-only (the invite route is owner-gated server-side; hide the form from everyone else). */}
        {!isOwner ? (
          <div className="mw-inset rounded-[20px] p-5 mt-7 text-[14px] text-ink-mid">You&apos;re viewing this org&apos;s members. Only the <span className="font-semibold text-ink">owner</span> can invite teammates or change roles.</div>
        ) : (<>
        <SLabel>Invite a teammate</SLabel>
        <div className="mw-raise rounded-[24px] p-6">
          <label className="block"><span className="text-[13px] font-semibold text-ink-mid"><span className="font-geist-mono text-ink-soft mr-1.5">1</span>Their email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@org.xyz" className="mt-1.5 w-full rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px]" />
          </label>
          <div className="mt-4">
            <span className="text-[13px] font-semibold text-ink-mid"><span className="font-geist-mono text-ink-soft mr-1.5">2</span>Their role</span>
            <div className="grid grid-cols-3 max-[640px]:grid-cols-1 gap-2 mt-1.5 p-1.5 rounded-[16px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
              {ROLE_PRESET_LIST.filter((p) => p.preset !== 'owner').map((p) => {
                const on = inviteRole === p.preset
                return (
                  <button key={p.preset} type="button" onClick={() => setInviteRole(p.preset)} aria-pressed={on}
                    className="text-left rounded-[12px] border-0 p-3 cursor-pointer transition-[box-shadow,background] duration-200"
                    style={on ? { background: '#fff', boxShadow: 'var(--mw-raise-sm), 0 0 0 2px rgba(91,91,230,.4)' } : { background: 'transparent' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14.5px] font-semibold text-ink">{p.label}</span>
                      {on && <span className="text-[14px]" style={{ color: 'var(--mw-peri-deep)' }} aria-hidden>✓</span>}
                    </div>
                    <div className="text-[12.5px] font-geist-mono mt-0.5" style={{ color: 'var(--mw-peri-deep)' }}>{capText(p.dailyCapUsdc)}</div>
                    <div className="text-[12.5px] text-ink-mid mt-1 leading-[1.4]">{p.blurb}</div>
                  </button>
                )
              })}
            </div>
          </div>
          <button onClick={invite} disabled={busy === 'invite' || !email} className="mt-5 mw-btn !min-h-[44px] disabled:opacity-50 disabled:cursor-default">{busy === 'invite' ? 'Signing…' : `Invite as ${ROLE_PRESET_LIST.find((p) => p.preset === inviteRole)?.label ?? 'member'}`}</button>
        </div>
        {msg && <div role="status" className="mt-3 rounded-[14px] bg-[#FBE9E7] px-4 py-3 text-[13.5px] text-[#B42318]">{msg}</div>}
        {lastLink && (
          <div className="mw-raise rounded-[20px] p-5 mt-3" style={{ outline: '1.5px solid rgba(15,122,67,.25)', outlineOffset: -1.5 }}>
            <div className="text-[14px] text-ink"><span className="font-semibold">{lastLink.email}</span> invited. Send them this link to accept — sign-in is gated to their email, and accepting mints their membership.</div>
            <div className="flex items-center gap-2 mt-2.5 max-[560px]:flex-col max-[560px]:items-stretch">
              <code className="flex-1 font-geist-mono text-[12.5px] text-ink-mid rounded-[12px] px-3.5 py-2.5 overflow-x-auto whitespace-nowrap" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>{lastLink.url}</code>
              <button onClick={() => { navigator.clipboard?.writeText(lastLink.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }} className="shrink-0 mw-btn !min-h-[40px]">{copied ? 'Copied ✓' : 'Copy link'}</button>
            </div>
            <div className="text-[12.5px] text-ink-soft mt-2.5">No email is sent automatically — share the link however you like (email, Slack, DM).</div>
          </div>
        )}
        </>
        )}

        {/* roster */}
        <SLabel>Members · {members.length}</SLabel>
        <div className="mw-raise rounded-[22px] overflow-hidden">
          {members.length === 0 && <div className="px-5 py-10 text-center text-[14px] text-ink-soft">No members yet. Invite your first teammate.</div>}
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-4 px-5 py-4 border-b border-[rgba(21,21,29,.06)] last:border-b-0 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-2.5">
              <span className="w-10 h-10 rounded-full shrink-0 max-[560px]:hidden" style={{ background: 'var(--mw-sheen)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)' }} aria-hidden />
              <div className="flex-1 min-w-0">
                <div className={`text-[15px] font-semibold text-ink truncate ${m.wallet ? 'font-geist-mono' : ''}`}>{m.wallet ? `${m.wallet.slice(0, 6)}…${m.wallet.slice(-4)}` : m.invited_email}</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {m.status === 'active' ? <StatusChip tone="live">Active</StatusChip> : <StatusChip tone="building">{m.status === 'pending' ? 'Invited' : m.status}</StatusChip>}
                  {m.eas_uid && <span className="text-[12.5px]" style={{ color: 'var(--mw-gain)' }}>Attested ✓</span>}
                </div>
              </div>
              <select value={(m.role || 'contributor') as RolePreset} onChange={(e) => setRole(m.id, e.target.value as RolePreset)} disabled={busy === m.id}
                className="rounded-[12px] border-0 bg-[#EEEEF4] shadow-[inset_0_1px_2px_rgba(21,21,29,.08),inset_0_0_0_1px_rgba(21,21,29,.05)] min-h-[44px] px-3.5 outline-none focus-visible:outline-2 focus-visible:outline-[#5B5BE6] text-[14px] !w-auto disabled:opacity-50">
                {ROLE_PRESET_LIST.map((p) => <option key={p.preset} value={p.preset}>{p.label}</option>)}
              </select>
            </div>
          ))}
        </div>

        {/* Next step in the flow: once teammates accept, secure the treasury with them as signers. Owner-only. */}
        {isOwner && (
          <Link href={`/app/org/${slug}/control/setup`} className="mw-raise mw-lift mt-4 flex items-center justify-between gap-3 rounded-[20px] px-5 py-4 no-underline max-[560px]:flex-col max-[560px]:items-start">
            <span className="flex items-center gap-3.5"><IconTile><IconShield /></IconTile><span className="text-[14px] text-ink-mid"><b className="text-ink">Next: secure the treasury with these people.</b> Once they&apos;ve accepted, set up an M-of-N multisig and they become your passkey signers.</span></span>
            <span className="font-semibold text-[14px] shrink-0" style={{ color: 'var(--mw-peri-deep)' }}>Set up multisig →</span>
          </Link>
        )}
      </div>
    </MwAuthGuard>
  )
}

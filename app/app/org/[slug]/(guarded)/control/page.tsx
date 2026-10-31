'use client'

// Treasury Control (P3) — the 21st-century answer to "who controls the treasury". No MetaMask
// multisig: the vault is owned by the org owner's PRIVY wallet (email/passkey, no seed), and
// day-to-day spend is governed by role caps checked on every payment request — not by
// collecting signatures. This surface makes that model explicit AND verifies it on-chain
// (reads vault.owner() and checks it matches the org owner). Layer 2 (multisig quorum via Privy
// passkeys + session keys) is the next step and is flagged honestly. Chrome comes from the shared
// TeamTerminalShell layout — this is the real "Policy & Approvals."

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHead, SLabel, StatusChip, IconShield } from '@/components/web2/TeamKit'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { ROLE_PRESET_LIST } from '@/lib/org/rolePresets'

interface TreasuryResp {
  org?: { id: string; name: string; slug: string; ownerWallet: string }
  funded?: boolean
  control?: {
    onchainOwner: string | null
    ownerMatchesOrg: boolean
    multisig: { threshold: number; owners: string[] } | null
  }
}

const short = (a?: string | null) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? '—')
function capLabel(c: bigint | null): string {
  if (c === null) return 'Uncapped'
  if (c === 0n) return 'Receive-only'
  return `$${(Number(c) / 1e6).toLocaleString()}/day`
}

export default function ControlPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address } = useMintwareIdentity()
  const [data, setData] = useState<TreasuryResp | null>(null)

  useEffect(() => {
    const q = address ? `?address=${address}` : ''
    fetch(`/api/orgs/${slug}/treasury${q}`).then((r) => r.json()).then(setData).catch(() => setData({}))
  }, [slug, address])

  const org = data?.org
  const funded = !!data?.funded
  const ctl = data?.control
  const ms = ctl?.multisig ?? null // Safe multisig owner (L2), if the treasury is behind one
  const isOwner = !!(address && org && address.toLowerCase() === org.ownerWallet?.toLowerCase())

  return (
    <MwAuthGuard>
      <div className="max-w-[860px] mx-auto">
        <PageHead
          back={{ href: `/app/org/${slug}`, label: org?.name ?? 'Org' }}
          icon={<IconShield size={24} />}
          title="Treasury control"
          lede="Who can change the treasury, and how much each role can spend. No MetaMask multisig: control sits with your Privy login, and spending is limited by role caps rather than collected signatures."
        />

        {/* ── 1. Owner / control model ── */}
        <SLabel>1 · Who controls it</SLabel>
        <section className="mw-raise rounded-[24px] p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
            <div className="min-w-0">
              <div className="text-[16px] font-semibold text-ink">{ms ? 'Owned by your team multisig' : 'Owned by your Privy wallet'}</div>
              <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-1.5 max-w-[52ch]">
                {ms
                  ? `${ms.threshold}-of-${ms.owners.length} approval on config changes and large withdrawals. Signers are your team's Privy wallets — each approves with a passkey. No MetaMask, no signing dance.`
                  : 'Email or passkey login → a real non-custodial wallet. No seed phrase, no browser extension. This is the config authority: it can change settings and move backing.'}
              </p>
              <div className="mt-3 text-[12.5px] font-mono text-ink-mid">
                {ms
                  ? <>Safe: <span className="text-ink">{short(ctl?.onchainOwner)}</span> · {ms.owners.length} signers</>
                  : <>Owner (org): <span className="text-ink">{short(org?.ownerWallet)}</span>{isOwner && <span className="text-mw-green"> · that&apos;s you</span>}</>}
              </div>
            </div>
            {/* On-chain verification — the real assurance */}
            <div className="rounded-[16px] px-4 py-3 text-[13px] shrink-0" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
              <div className="text-[12.5px] font-semibold text-ink-mid">On-chain check</div>
              {!funded ? (
                <div className="text-ink-soft mt-1.5">Set once the treasury is live</div>
              ) : ms ? (
                <div className="mt-1.5"><StatusChip tone="live">{ms.threshold}-of-{ms.owners.length} multisig</StatusChip><div className="font-mono text-[11px] text-ink-soft mt-1.5">vault.owner() = Safe ✓</div></div>
              ) : ctl?.ownerMatchesOrg ? (
                <div className="mt-1.5"><StatusChip tone="live">Owner verified</StatusChip><div className="font-mono text-[11px] text-ink-soft mt-1.5">vault.owner() = {short(ctl.onchainOwner)}</div></div>
              ) : (
                <div className="mt-1.5"><StatusChip tone="warn">Owner mismatch</StatusChip><div className="font-mono text-[11px] text-ink-soft font-normal mt-1">on-chain: {short(ctl?.onchainOwner)}</div></div>
              )}
            </div>
          </div>
        </section>

        {/* ── 2. Spend policy (role caps) ── */}
        <SLabel right={<Link href={`/app/org/${slug}/roles`} className="mw-btn-quiet !min-h-[36px] text-[13px]">Assign members →</Link>}>2 · Spend policy</SLabel>
        <section className="mw-raise rounded-[24px] p-6">
          <p className="m-0 text-[14.5px] text-ink-mid leading-[1.55] max-w-[62ch]">
            Each role carries a fixed daily cap. A payment request within the cap is recorded with <b className="text-ink">no per-payment approval</b>;
            one over the cap, or over the treasury&apos;s available balance, is refused. Cards will spend from their own prefunded balance, refilled within limits.
          </p>
          <div className="mt-5 overflow-x-auto rounded-[16px]" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
            <table className="w-full border-collapse text-[13px] min-w-[520px]">
              <thead>
                <tr>
                  {['Role', 'Daily cap', 'Pay vendors', 'Invite', 'Manage treasury'].map((h, i) => (
                    <th key={h} className={`text-[12px] font-semibold text-ink-soft px-4 py-3 border-b border-[rgba(21,21,29,.08)] ${i === 0 ? 'text-left' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLE_PRESET_LIST.map((r) => (
                  <tr key={r.preset} className="border-b border-[rgba(21,21,29,.06)] last:border-0">
                    <td className="px-4 py-3"><span className="text-[12.5px] font-semibold rounded-full bg-white px-2.5 py-0.5 text-ink shadow-[0_0_0_1px_rgba(21,21,29,.06)] capitalize">{r.preset}</span></td>
                    <td className="px-3.5 py-2.5 font-geist-mono text-[13px] text-ink">{capLabel(r.dailyCapUsdc)}</td>
                    <td className="px-4 py-3">{r.canPayVendors ? <span className="text-[#0F7A43]">✓</span> : <span className="text-ink-soft">—</span>}</td>
                    <td className="px-4 py-3">{r.canInvite ? <span className="text-[#0F7A43]">✓</span> : <span className="text-ink-soft">—</span>}</td>
                    <td className="px-4 py-3">{r.canManageTreasury ? <span className="text-[#0F7A43]">✓</span> : <span className="text-ink-soft">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 3. Layer 2 — quorum, honestly teed up ── */}
        <SLabel>3 · Multisig</SLabel>
        <section className={`rounded-[24px] p-6 ${ms ? 'mw-raise' : 'mw-tex-dots'}`} style={ms ? { outline: '1.5px solid rgba(15,122,67,.25)', outlineOffset: -1.5 } : { backgroundColor: '#F1F0FB', boxShadow: 'var(--mw-inset)' }}>
          <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            {ms ? '✓ Multisig-grade, no MetaMask' : 'Next — multisig-grade, still no MetaMask'}
          </div>
          <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-2.5 max-w-[62ch]">
            {ms ? (
              <>Config &amp; large withdrawals require <b className="text-ink">{ms.threshold}-of-{ms.owners.length} passkey approval</b> from
              your team&apos;s Privy wallets — no browser-extension signing. Routine spend still needs
              <b className="text-ink"> no popup</b> (it runs within role caps). The remaining upgrade is
              session-key delegation for fully-automated spend, which uses Privy server-auth
              (<span className="font-mono text-[12px]">PRIVY_APP_SECRET</span>).</>
            ) : (
              <>Layer 2 puts the treasury behind a smart account whose signers are your team&apos;s Privy
              wallets: <b className="text-ink">M-of-N approval for config &amp; large withdrawals</b>, confirmed by
              passkey — not a browser-extension signing dance — plus session keys so routine spend needs
              no popup at all. It needs Privy server-auth (<span className="font-mono text-[12px]">PRIVY_APP_SECRET</span>) enabled on the plan.</>
            )}
          </p>
          {!ms && isOwner && funded && (
            <Link href={`/app/org/${slug}/control/setup`} className="mt-4 mw-btn !min-h-[40px]">Set up multisig →</Link>
          )}
        </section>
      </div>
    </MwAuthGuard>
  )
}

'use client'

// Treasury Control (P3) — the 21st-century answer to "who controls the treasury". No MetaMask
// multisig: the vault is owned by the org owner's PRIVY wallet (email/passkey, no seed), and
// day-to-day spend is governed by role caps enforced on every transaction by edge-auth — not by
// collecting signatures. This surface makes that model explicit AND verifies it on-chain
// (reads vault.owner() and checks it matches the org owner). Layer 2 (multisig quorum via Privy
// passkeys + session keys) is the next step and is flagged honestly.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
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
  const isOwner = !!(address && org && address.toLowerCase() === org.ownerWallet.toLowerCase())

  return (
    <MwAuthGuard allowDisconnected>
      <div className="min-h-screen bg-white font-atx-display text-ink">
        <MwNav />
        <main className="mx-auto max-w-[860px] px-6 max-[700px]:px-4 py-[44px]">
          <div className="flex items-center gap-3 flex-wrap">
            <Link href={`/app/org/${slug}`} className="text-[13px] text-ink-soft hover:text-ink no-underline">← {org?.name ?? 'Org'}</Link>
          </div>
          <h1 className="font-atx-display font-semibold text-[clamp(1.6rem,3.4vw,2.1rem)] tracking-[-0.03em] mt-2">Treasury <span className="text-gradient-accent">control</span></h1>
          <p className="text-ink-mid text-[14.5px] leading-[1.55] max-w-[64ch] mt-2.5">
            No MetaMask multisig. Your treasury is controlled by your Privy login, and spending is
            governed by role caps enforced on every transaction — not by collecting signatures.
          </p>

          {/* ── 1. Owner / control model ── */}
          <section className="soft-card p-6 mt-7">
            <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Who controls it</div>
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
              <div className="rounded-[12px] border border-hair bg-ground-cool px-4 py-3 text-[12px] shrink-0">
                <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">On-chain check</div>
                {!funded ? (
                  <div className="text-ink-soft mt-1.5">Set once the treasury is live</div>
                ) : ms ? (
                  <div className="mt-1.5"><span className="live-chip"><span className="dot" aria-hidden />{ms.threshold}-of-{ms.owners.length} multisig</span><div className="font-mono text-[11px] text-ink-soft mt-1.5">vault.owner() = Safe ✓</div></div>
                ) : ctl?.ownerMatchesOrg ? (
                  <div className="mt-1.5"><span className="live-chip"><span className="dot" aria-hidden />Owner verified</span><div className="font-mono text-[11px] text-ink-soft mt-1.5">vault.owner() = {short(ctl.onchainOwner)}</div></div>
                ) : (
                  <div className="mt-1.5 text-[#B4690E] font-semibold">⚠ Owner mismatch<div className="font-mono text-[11px] text-ink-soft font-normal mt-1">on-chain: {short(ctl?.onchainOwner)}</div></div>
                )}
              </div>
            </div>
          </section>

          {/* ── 2. Spend policy (role caps) ── */}
          <section className="soft-card p-6 mt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Spend policy</div>
              <Link href={`/app/org/${slug}/roles`} className="glass-pill glass-pill-sm no-underline">Assign members →</Link>
            </div>
            <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-2.5 max-w-[60ch]">
              Every card swipe and payment is authorized in ~10&nbsp;ms against these role caps by the
              edge-auth engine — within cap it settles with <b className="text-ink">no per-transaction approval</b>;
              over cap or over available NAV, it&apos;s declined.
            </p>
            <div className="mt-4 overflow-x-auto rounded-[12px] border border-hair">
              <table className="w-full border-collapse text-[13px] min-w-[520px]">
                <thead>
                  <tr className="bg-ground-cool">
                    {['Role', 'Daily cap', 'Pay vendors', 'Invite', 'Manage treasury'].map((h, i) => (
                      <th key={h} className={`text-[10px] uppercase tracking-[0.09em] font-semibold text-ink-soft px-3.5 py-2.5 border-b border-hair ${i === 0 ? 'text-left' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROLE_PRESET_LIST.map((r) => (
                    <tr key={r.preset} className="border-b border-hair-soft last:border-0">
                      <td className="px-3.5 py-2.5"><span className="text-[10px] uppercase tracking-[0.06em] font-semibold rounded-full border border-hair bg-ground-cool px-2 py-0.5 text-ink-mid">{r.preset}</span></td>
                      <td className="px-3.5 py-2.5 font-mono text-[12.5px] tabular-nums text-ink">{capLabel(r.dailyCapUsdc)}</td>
                      <td className="px-3.5 py-2.5">{r.canPayVendors ? '✓' : <span className="text-ink-soft">—</span>}</td>
                      <td className="px-3.5 py-2.5">{r.canInvite ? '✓' : <span className="text-ink-soft">—</span>}</td>
                      <td className="px-3.5 py-2.5">{r.canManageTreasury ? '✓' : <span className="text-ink-soft">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 3. Layer 2 — quorum, honestly teed up ── */}
          <section className="mt-4 rounded-[16px] border border-[rgba(108,108,240,0.3)] p-6"
            style={{ background: 'linear-gradient(120deg, rgba(108,108,240,0.06), var(--color-ground-cool))' }}>
            <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">
              {ms ? '✓ Multisig-grade, no MetaMask' : 'Next — multisig-grade, still no MetaMask'}
            </div>
            <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-2.5 max-w-[62ch]">
              {ms ? (
                <>Config &amp; large withdrawals require <b className="text-ink">{ms.threshold}-of-{ms.owners.length} passkey approval</b> from
                your team&apos;s Privy wallets — no browser-extension signing. Routine spend still needs
                <b className="text-ink"> no popup</b> (edge-auth authorizes within role caps). The remaining upgrade is
                session-key delegation for fully-automated spend, which uses Privy server-auth
                (<span className="font-mono text-[12px]">PRIVY_APP_SECRET</span>).</>
              ) : (
                <>Layer 2 puts the treasury behind a smart account whose signers are your team&apos;s Privy
                wallets: <b className="text-ink">M-of-N approval for config &amp; large withdrawals</b>, confirmed by
                passkey — not a browser-extension signing dance — plus session keys so routine spend needs
                no popup at all. It needs Privy server-auth (<span className="font-mono text-[12px]">PRIVY_APP_SECRET</span>) enabled on the plan.</>
              )}
            </p>
          </section>
        </main>
      </div>
    </MwAuthGuard>
  )
}

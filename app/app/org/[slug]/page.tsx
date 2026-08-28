'use client'

// Org home (authenticated) — leads with the MEMBER CARD (#2), the wow: your role, spendable-right-now
// (par while covered), and the one line that makes "spendable while earning" legible. Then the treasury snapshot
// and role-gated action tiles (fund #1 · pay #4 · payroll #5 · roles #3). Not a dashboard — a card + tiles.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { policyForRole, type RolePolicy } from '@/lib/org/rolePresets'

interface TreasuryResp {
  org: { id: string; name: string; slug: string; ownerWallet: string }
  treasuryVaultAddress: string | null
  treasuryChainId: number | null
  memberCount: number
  funded: boolean
  snapshot: { navUsdc: string; coverageBps: number | null; deployedUsdc: string; juniorBufferUsdc: string; fullyCovered: boolean } | null
  member: { address: string; spendableUsdc: string; role: string | null; status: string | null; easUid: string | null } | null
}

const usd = (a: string | undefined) => {
  const n = Number(a ?? '0') / 1e6
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1e3).toFixed(1)}k`
  return `$${n.toFixed(2)}`
}
const covPctOf = (s: TreasuryResp['snapshot']) => (!s ? '—' : s.coverageBps === null ? '∞' : `${(s.coverageBps / 100).toFixed(0)}%`)

export default function OrgHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { address, isConnected } = useMintwareIdentity()
  const [data, setData] = useState<TreasuryResp | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    const q = address ? `?address=${address}` : ''
    fetch(`/api/orgs/${slug}/treasury${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then(setData)
      .catch(() => setErr('Org not found.'))
  }, [slug, address])
  useEffect(() => { load() }, [load])

  const policy: RolePolicy = policyForRole(data?.member?.role)
  const isMember = !!data?.member && data.member.status === 'active'
  const isOwner = !!(data && address && data.org.ownerWallet?.toLowerCase() === address.toLowerCase())

  const tiles = [
    { href: `pay`,     label: 'Pay a vendor',  sub: 'One payment, any chain',         show: policy.canPayVendors || isOwner },
    { href: `payroll`, label: 'Run payroll',   sub: 'CSV → one batch settlement',     show: policy.canPayVendors || isOwner },
    { href: `roles`,   label: 'Members & roles',sub: 'Invite · assign a preset',      show: isOwner || policy.canManageTreasury },
    { href: `control`, label: 'Treasury control',sub: 'Privy-owned · role-cap policy',  show: true },
    { href: `cards`,   label: 'Cards & spend', sub: 'Issue · activate · swipe live',  show: isMember || isOwner },
  ].filter((t) => t.show)

  return (
    <MwAuthGuard>
      <div className="min-h-screen font-atx-display bg-white text-ink overflow-x-clip">
        <MwNav />
        <main className="mx-auto max-w-[1000px] px-6 max-[700px]:px-4 py-[44px]">
          {err && <div className="py-24 text-center text-ink-soft">{err}</div>}
          {data && (
            <>
              {/* header */}
              <div className="flex items-center justify-between gap-4 mb-8">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Org treasury</div>
                  <h1 className="font-atx-display font-semibold text-ink tracking-[-0.03em] text-[28px] leading-tight mt-1">{data.org.name}</h1>
                </div>
                <div className="flex items-center gap-3">
                  <Link href={`/org/${slug}`} target="_blank" className="text-[12.5px] font-medium text-peri-deep no-underline hover:underline">Public page ↗</Link>
                  {address && <WalletDisplay address={address} mono className="text-ink text-[13px] font-medium" />}
                </div>
              </div>

              {/* MEMBER CARD — the wow */}
              <section className="mw-hero-gradient rounded-[var(--radius-card)] p-6 max-[600px]:p-5 relative overflow-hidden">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white">
                    {isMember ? (policy.label + ' · member') : isOwner ? 'Owner' : 'Not a member'}
                  </span>
                  <span className="text-[11px] text-white/70">{data.member?.easUid ? 'Attested on-chain ✓' : ''}</span>
                </div>
                <div className="mt-5">
                  <div className="text-[12px] uppercase tracking-[0.1em] font-semibold text-white/70">Spendable right now</div>
                  <div className="font-atx-display font-semibold text-white text-[clamp(2.2rem,6vw,3.4rem)] tabular-nums leading-none mt-1.5">
                    {isConnected ? usd(data.member?.spendableUsdc) : '—'}
                  </div>
                  <div className="text-[13px] text-white/80 mt-2">
                    Redeemable at par while the treasury covers it.{' '}
                    <span className="text-white font-medium">Never idle, never locked, always yours.</span>
                  </div>
                </div>
                <div className="mt-6 pt-5 border-t border-white/15 flex items-center gap-6 max-[520px]:flex-wrap max-[520px]:gap-3">
                  <div><div className="text-[11px] text-white/60 uppercase tracking-[0.08em]">Treasury coverage</div><div className="text-white font-semibold text-[17px] tabular-nums">{covPctOf(data.snapshot)}</div></div>
                  <div><div className="text-[11px] text-white/60 uppercase tracking-[0.08em]">Total backing</div><div className="text-white font-semibold text-[17px] tabular-nums">{data.snapshot ? usd(data.snapshot.navUsdc) : '—'}</div></div>
                  <div><div className="text-[11px] text-white/60 uppercase tracking-[0.08em]">Members</div><div className="text-white font-semibold text-[17px] tabular-nums">{data.memberCount}</div></div>
                  <div className="ml-auto text-[11px] text-white/55">while your balance sits here, the treasury keeps earning</div>
                </div>
              </section>

              {/* Two ways to grow the treasury — Savings (one asset) vs Vaults (both assets). Kept distinct, never conflated. */}
              <section className="mt-8">
                <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft mb-3">Grow the treasury — two ways</div>
                <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3">
                  <Link href={`/app/org/${slug}/fund`} className="soft-card p-5 no-underline group hover:shadow-card-hover transition-shadow block">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-atx-display font-semibold text-[16px] text-ink group-hover:text-peri-deep transition-colors">Savings</div>
                      <span className="text-[9.5px] uppercase tracking-[0.08em] font-semibold text-ink-soft rounded-full border border-hair px-2 py-0.5 shrink-0">One asset</span>
                    </div>
                    <p className="text-[12.5px] text-ink-mid mt-2 leading-[1.5]">Park a single asset (USDC or ETH). Earns a steady yield, holds at par, and stays spendable on the card.</p>
                    <div className="text-[12.5px] font-semibold text-peri-deep mt-3">Open Savings →</div>
                  </Link>
                  <Link href="/app/vaults" className="soft-card p-5 no-underline group hover:shadow-card-hover transition-shadow block">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-atx-display font-semibold text-[16px] text-ink group-hover:text-peri-deep transition-colors">Vaults</div>
                      <span className="text-[9.5px] uppercase tracking-[0.08em] font-semibold text-ink-soft rounded-full border border-hair px-2 py-0.5 shrink-0">Both assets</span>
                    </div>
                    <p className="text-[12.5px] text-ink-mid mt-2 leading-[1.5]">Provide both assets as liquidity. Earns trading fees plus reputation-weighted rewards — deeper upside, with LP exposure.</p>
                    <div className="text-[12.5px] font-semibold text-peri-deep mt-3">Open Vaults →</div>
                  </Link>
                </div>
              </section>

              {!data.funded && (
                <div className="soft-card p-4 mt-4 flex items-center justify-between gap-4 max-[600px]:flex-col max-[600px]:items-start">
                  <div className="text-[12.5px] text-ink-mid">New here? Start with <span className="font-semibold text-ink">Savings</span> — one deposit, earning, and spendable.</div>
                  {(isOwner || policy.canManageTreasury) && <Link href={`/app/org/${slug}/fund`} className="shrink-0 rounded-full bg-peri text-white px-4 py-2 text-[13px] font-semibold no-underline hover:bg-peri-deep transition-colors">Set up Savings →</Link>}
                </div>
              )}

              {/* action tiles */}
              {tiles.length > 0 && (
                <div className="grid grid-cols-4 max-[820px]:grid-cols-2 gap-3 mt-8">
                  {tiles.map((t) => (
                    <Link key={t.href} href={`/app/org/${slug}/${t.href}`} className="soft-card p-4 no-underline group hover:shadow-card-hover transition-shadow">
                      <div className="font-atx-display font-semibold text-[15px] text-ink group-hover:text-peri-deep transition-colors">{t.label}</div>
                      <div className="text-[12px] text-ink-soft mt-1">{t.sub}</div>
                    </Link>
                  ))}
                </div>
              )}

              {!isMember && !isOwner && isConnected && (
                <div className="text-[12.5px] text-ink-soft mt-6">You're viewing this treasury as a guest. Ask an owner to invite your wallet to spend.</div>
              )}
            </>
          )}
        </main>
      </div>
    </MwAuthGuard>
  )
}

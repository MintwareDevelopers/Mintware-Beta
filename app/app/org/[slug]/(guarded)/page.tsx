'use client'

// Org home (authenticated) — leads with the MEMBER CARD: your role and what you can spend right now (par while
// covered), then the two ways to grow the treasury, then role-gated action tiles (pay · payroll · roles · control ·
// cards · activity). Mineral: a raised member card lit by the sheen, raised tiles with disc icons. Not a dashboard.
// Chrome comes from the shared TeamTerminalShell layout — this is the real "Overview" once an org is active.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { policyForRole, type RolePolicy } from '@/lib/org/rolePresets'
import { PageHead, SLabel, StatusChip, IconTile, IconOrg, IconSend, IconBatch, IconPeople, IconShield, IconCard, IconLedger, IconGrow, IconPie } from '@/components/web2/TeamKit'

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

  // Tile copy says what each surface actually does today: pay/payroll RECORD instructions (on-chain recipient
  // settlement isn't built), and Bridge + Stripe cards are pre-enable.
  const tiles = [
    { href: `pay`,     label: 'Pay a vendor',     sub: 'Record one payment to the ledger', icon: <IconSend />,   show: policy.canPayVendors || isOwner },
    { href: `payroll`, label: 'Run payroll',      sub: 'CSV in, one recorded batch',       icon: <IconBatch />,  show: policy.canPayVendors || isOwner },
    { href: `roles`,   label: 'Members & roles',  sub: 'Invite, assign a preset',          icon: <IconPeople />, show: isOwner || policy.canManageTreasury },
    { href: `control`, label: 'Treasury control', sub: 'Who controls it, role caps',       icon: <IconShield />, show: true },
    { href: `cards`,   label: 'Cards & spend',    sub: 'Bridge + Stripe, pre-enable',      icon: <IconCard />,   show: isMember || isOwner },
    { href: `activity`,label: 'Activity',         sub: 'Every payment, reports, CSV',      icon: <IconLedger />, show: isMember || isOwner },
  ].filter((t) => t.show)

  return (
    <MwAuthGuard>
      <div className="max-w-[1000px] mx-auto">
        {err && <div className="py-24 text-center text-ink-soft">{err}</div>}
        {data && (
          <>
            <PageHead
              icon={<IconOrg size={24} />}
              title={data.org.name}
              status={data.funded ? { tone: 'live', label: 'Treasury live' } : { tone: 'building', label: 'Setting up' }}
              lede="Your org treasury: what you can spend, how it grows, and everything your team can do with it."
              actions={<>
                <Link href={`/org/${slug}`} target="_blank" className="mw-btn-quiet !min-h-[40px] text-[13.5px]">Public page ↗</Link>
                {address && <span className="mw-raise-sm inline-flex items-center gap-2 rounded-[12px] px-3 min-h-[40px] text-[13px]"><span className="w-5 h-5 rounded-full" style={{ background: 'var(--mw-sheen)' }} aria-hidden /><WalletDisplay address={address} mono className="text-ink text-[13px] font-medium" /></span>}
              </>}
            />

            {/* MEMBER CARD — raised, lit by one patch of sheen */}
            <section className="mw-raise-lg relative overflow-hidden rounded-[28px] p-[clamp(20px,3vw,32px)] mt-7">
              <div aria-hidden className="absolute -right-24 -top-28 w-[380px] h-[380px] rounded-full opacity-30 blur-[60px]" style={{ background: 'var(--mw-sheen)' }} />
              <div className="relative flex items-center justify-between gap-3 flex-wrap">
                <StatusChip tone={isMember || isOwner ? 'live' : 'muted'}>{isMember ? `${policy.label} · member` : isOwner ? 'Owner' : 'Not a member'}</StatusChip>
                {data.member?.easUid && <span className="text-[12.5px] font-medium" style={{ color: 'var(--mw-gain)' }}>Attested on-chain ✓</span>}
              </div>
              <div className="relative mt-6">
                <div className="text-[14px] text-ink-mid">Spendable right now</div>
                <div className="font-geist-mono text-[clamp(40px,6vw,60px)] tracking-[-0.04em] leading-none mt-2">
                  {isConnected ? usd(data.member?.spendableUsdc) : '—'}
                </div>
                <div className="text-[14px] text-ink-mid mt-3">Redeemable at par while the treasury covers it.</div>
              </div>
              <div className="relative mt-7 grid grid-cols-3 max-[520px]:grid-cols-1 gap-3">
                {[['Treasury coverage', covPctOf(data.snapshot)], ['Total backing', data.snapshot ? usd(data.snapshot.navUsdc) : '—'], ['Members', String(data.memberCount)]].map(([k, v]) => (
                  <div key={k} className="rounded-[16px] px-4 py-3" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                    <div className="text-[12.5px] text-ink-soft">{k}</div>
                    <div className="font-geist-mono text-[19px] mt-1">{v}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Two ways to grow the treasury — one available, one not yet */}
            <SLabel>Grow the treasury</SLabel>
            <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3">
              <Link href={`/app/org/${slug}/fund`} className="mw-raise mw-lift rounded-[22px] p-5 no-underline block">
                <div className="flex items-start justify-between gap-3"><IconTile><IconGrow /></IconTile><StatusChip tone="live">Testnet</StatusChip></div>
                <div className="font-semibold text-[18px] tracking-[-0.02em] text-ink mt-4">Treasury yield</div>
                <p className="text-[14px] text-ink-mid mt-1.5 leading-[1.5]">Supply one asset (USDC) to a yield vault. Variable lending rate, withdraw any time.</p>
                <div className="inline-flex items-center gap-1.5 text-[14px] font-semibold mt-3" style={{ color: 'var(--mw-peri-deep)' }}>Open Treasury yield →</div>
              </Link>
              <div className="mw-inset mw-tex-hatch rounded-[22px] p-5">
                <div className="flex items-start justify-between gap-3"><IconTile><IconPie /></IconTile><StatusChip tone="planned">Not available yet</StatusChip></div>
                <div className="font-semibold text-[18px] tracking-[-0.02em] text-ink mt-4">Liquidity for your token</div>
                <p className="text-[14px] text-ink-mid mt-1.5 leading-[1.5]">Curated pools use one MarketEngine per Uniswap v4 pool. Community matching and staged one-sided deployment are retired.</p>
              </div>
            </div>

            {!data.funded && (
              <div className="mw-raise rounded-[18px] p-4 mt-3 flex items-center justify-between gap-4 max-[600px]:flex-col max-[600px]:items-start" style={{ outline: '1.5px solid rgba(91,91,230,.26)', outlineOffset: -1.5 }}>
                <div className="text-[14px] text-ink-mid">New here? Start with <span className="font-semibold text-ink">Treasury yield</span>: supply USDC once and it starts earning a variable rate.</div>
                {(isOwner || policy.canManageTreasury) && <Link href={`/app/org/${slug}/fund`} className="shrink-0 mw-btn !min-h-[40px]">Set up Treasury yield</Link>}
              </div>
            )}

            {/* action tiles */}
            {tiles.length > 0 && (
              <>
                <SLabel>Run the treasury</SLabel>
                <div className="grid grid-cols-3 max-[820px]:grid-cols-2 max-[480px]:grid-cols-1 gap-3">
                  {tiles.map((t) => (
                    <Link key={t.href} href={`/app/org/${slug}/${t.href}`} className="mw-raise mw-lift rounded-[20px] p-4 no-underline flex items-center gap-3.5">
                      <IconTile>{t.icon}</IconTile>
                      <span className="min-w-0"><span className="block font-semibold text-[15.5px] text-ink">{t.label}</span><span className="block text-[13px] text-ink-soft mt-0.5">{t.sub}</span></span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            {!isMember && !isOwner && isConnected && (
              <div className="mw-inset rounded-[16px] px-4 py-3 text-[14px] text-ink-mid mt-6">You&apos;re viewing this treasury as a guest. Ask an owner to invite your wallet to spend.</div>
            )}
          </>
        )}
      </div>
    </MwAuthGuard>
  )
}

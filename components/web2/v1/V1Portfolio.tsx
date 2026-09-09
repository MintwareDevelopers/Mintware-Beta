'use client'

// Portfolio — the V1 account/profile "money home". Borrows the V2 identity layer (avatar + bio + socials,
// via useProfileMeta) and pairs it with REAL V1 data (no mocks): a working-balance hero, a stats strip, and
// per-pool position cards (value + net PnL + value sparkline). Cross-pool via /api/gateway/positions. Dark
// app skin. Honest: chain-derived figures only.
//
// Earn-vs-LP decision (2026-09-08): the "spendable buffer" reveal this page used to show is gone — the A-4
// buffer-credit path is dropped (harvest always restakes now), so there is nothing left to reveal. See
// docs/developers/lp-gateway-earn-vs-lp-decision.md.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useProfileMeta } from '@/lib/rewards/useProfileMeta'
import { TokenPair } from '@/components/web2/v1/TokenPair'
import { Sparkline } from '@/components/web2/v1/Sparkline'
import { V1EditProfile } from '@/components/web2/v1/V1EditProfile'
import { V1WalletCoins } from '@/components/web2/v1/V1WalletCoins'
import { shortAddr } from '@/lib/web2/api'

type PoolPosition = {
  poolAddress: string
  pairLabel: string | null
  shares: string
  positionValueAtomic: string | null
  costBasisAtomic: string | null
  unrealizedPnlAtomic: string | null
  recorded?: boolean // false ⇒ chain shows the position but its deposit was never recorded (basis unknown)
  source?: 'registry' | 'env-fallback'
  live?: boolean
  valueSeries?: number[]
}

const CARD = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }
const INNER = { background: '#0E0E16', border: '1px solid rgba(255,255,255,0.06)' }

const num = (a: string | null | undefined): number => { if (a == null) return 0; try { return Number(BigInt(a)) / 1e6 } catch { return 0 } }
const usdg = (a: string | null | undefined) => `$${num(a).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmt = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
// Audit O-2: /earn/[pool] is keyed by the registry pool id, never the pair label (see V1Discover).
const slugOf = (p: PoolPosition) => encodeURIComponent(p.poolAddress.toLowerCase())
const pairParts = (label: string | null) => {
  const [b, q] = (label || 'TOKEN / USDG').split('/').map((s) => s.replace(/\s*\d.*$/, '').trim())
  return { base: b || 'TOKEN', quote: q || 'USDG' }
}

export function V1Portfolio() {
  const { address, isConnected, walletType, disconnect } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const connect = () => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })
  const { meta, refetch: refetchMeta } = useProfileMeta(address)
  const [positions, setPositions] = useState<PoolPosition[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    if (!address) { setPositions([]); return }
    setLoading(true)
    fetch(`/api/gateway/positions?address=${address}`)
      .then((r) => r.json())
      .then((d) => setPositions(d?.success && Array.isArray(d.positions) ? (d.positions as PoolPosition[]) : []))
      .catch(() => setPositions([]))
      .finally(() => setLoading(false))
  }, [address])

  const totalWorking = useMemo(() => positions.reduce((s, p) => s + num(p.positionValueAtomic), 0), [positions])
  const totalPnl = useMemo(() => positions.reduce((s, p) => s + num(p.unrealizedPnlAtomic), 0), [positions])
  const totalDeposited = useMemo(() => positions.reduce((s, p) => s + num(p.costBasisAtomic), 0), [positions])

  const name = meta?.displayName || meta?.basename || (address ? shortAddr(address) : '')
  const avatarLetter = address ? address.charAt(2).toUpperCase() : '?'
  const copyAddr = async () => { if (!address) return; try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ } }

  if (!isConnected) {
    return (
      <div>
        <Header />

        {/* value hero — sell the money-home before connect, no bare button */}
        <div className="mt-6 rounded-[18px] p-8 max-[640px]:p-5 relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#191830,#12121C)', border: '1px solid rgba(138,130,244,0.22)' }}>
          <div className="absolute -top-16 -right-10 w-[240px] h-[240px] rounded-full" style={{ background: 'radial-gradient(circle,rgba(138,130,244,0.2),transparent 70%)' }} />
          <div className="relative max-w-[48ch]">
            <h2 className="font-atx-display font-semibold text-[clamp(1.5rem,3.6vw,2rem)] tracking-[-0.03em] leading-[1.1]">Money that never sits still.</h2>
            <p className="text-[14.5px] leading-[1.6] mt-3" style={{ color: '#9B9BAD' }}>
              Deposit USDG — your full deposit becomes liquidity in a curated pool, earning trading fees.{' '}
              <b style={{ color: '#F4F4FA' }}>No held-back reserve. Withdraw anytime for both legs.</b>
            </p>
            <button onClick={connect} className="mt-5 text-[14px] font-semibold px-5 py-3 rounded-[14px] text-white cursor-pointer" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}>Connect wallet to open your account</button>
          </div>
        </div>

        {/* what you'll track — preview tiles (locked, no fake numbers) */}
        <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          {[['Working & earning', 'your live LP value'], ['Fees compounded', 'lifts your value pro-rata'], ['Net vs deposit', 'your P&L'], ['Positions', 'across curated pools']].map(([k, sub]) => (
            <div key={k} className="rounded-[14px] p-4" style={CARD}>
              <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>{k}</div>
              <div className="font-mono font-bold text-[20px] mt-1.5" style={{ color: '#3A3A46' }}>——</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: '#63636F' }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* the loop */}
        <div className="rounded-[16px] p-6 mt-4" style={CARD}>
          <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>How your account works</div>
          <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <Step n="01" t="Briefly staged" d="A short window before the next scheduled deploy — no yield accrues here." />
            <Step n="02" t="Deployed as liquidity" d="Your full deposit — no held-back reserve — is paired into a curated pool and earns trading fees." />
            <Step n="03" t="Fees compound back in" d="Trading fees lift your position's value pro-rata. Withdraw anytime for both legs." />
          </div>
        </div>

        <Foot />
      </div>
    )
  }

  return (
    <div>
      {editOpen && address && <V1EditProfile wallet={address} meta={meta} onClose={() => setEditOpen(false)} onSaved={refetchMeta} />}
      <Header />

      {/* 1 · identity */}
      <div className="mt-6 flex items-start gap-4 flex-wrap">
        <span className="w-[56px] h-[56px] rounded-full overflow-hidden flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }}>
          {meta?.avatar?.ref ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.avatar.ref} alt={name} width={56} height={56} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
          ) : (
            <span className="font-bold text-[22px] text-white">{avatarLetter}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-atx-display font-semibold text-[20px] tracking-[-0.02em] truncate">{name}</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ color: '#9B9BAD', background: 'rgba(255,255,255,0.06)' }}>{walletType === 'privy-embedded' ? 'Embedded' : 'External'}</span>
          </div>
          {meta?.bio && <p className="text-[13.5px] mt-1.5 leading-[1.55] max-w-[52ch]" style={{ color: '#9B9BAD' }}>{meta.bio}</p>}
          <Socials socials={meta?.socials} />
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <button onClick={copyAddr} className="inline-flex items-center gap-1.5 font-mono text-[12.5px] px-2.5 py-1.5 rounded-[10px] cursor-pointer" style={INNER} title="Copy address">
              <span style={{ color: '#9B9BAD' }}>{address ? shortAddr(address) : ''}</span>
              <span style={{ color: copied ? '#34D399' : '#63636F' }}>{copied ? '✓' : '⧉'}</span>
            </button>
            <button onClick={() => setEditOpen(true)} className="text-[12.5px] font-semibold cursor-pointer" style={{ color: '#8A82F4' }}>Edit profile</button>
            <button onClick={disconnect} className="text-[12.5px] font-semibold cursor-pointer" style={{ color: '#63636F' }}>Disconnect</button>
          </div>
        </div>
      </div>

      {/* 2 · working-balance hero */}
      <div className="mt-6 rounded-[18px] p-7 max-[640px]:p-5 relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#191830,#12121C)', border: '1px solid rgba(138,130,244,0.22)' }}>
        <div className="absolute -top-16 -right-10 w-[220px] h-[220px] rounded-full" style={{ background: 'radial-gradient(circle,rgba(138,130,244,0.18),transparent 70%)' }} />
        <div className="relative">
          <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#9B9BAD' }}>Working &amp; earning</div>
          <div className="font-mono font-bold tracking-[-0.02em] leading-none text-[clamp(2.4rem,7vw,3.4rem)] mt-2">
            {loading ? '—' : fmt(totalWorking)}
          </div>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {totalPnl !== 0 && (
              <span className="font-mono text-[13.5px] font-semibold px-2.5 py-1 rounded-full" style={{ color: totalPnl >= 0 ? '#34D399' : '#F0736E', background: totalPnl >= 0 ? 'rgba(52,211,153,0.12)' : 'rgba(240,115,110,0.12)' }}>
                {totalPnl >= 0 ? '+' : ''}{fmt(Math.abs(totalPnl))} net
              </span>
            )}
            <span className="text-[13px] max-w-[46ch]" style={{ color: '#9B9BAD' }}>Your positions earn trading fees, compounded back into their value — withdraw anytime for both legs.</span>
          </div>
          <div className="flex gap-2.5 mt-5 flex-wrap">
            <Link href="/v1" className="text-[13.5px] font-semibold px-5 py-2.5 rounded-full text-white no-underline" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}>+ Add USDG</Link>
            <Link href="/v1/leaderboard" className="text-[13.5px] font-semibold px-5 py-2.5 rounded-full no-underline" style={{ color: '#F4F4FA', border: '1px solid rgba(255,255,255,0.12)' }}>Leaderboard →</Link>
          </div>
        </div>
      </div>

      {/* 3 · stats strip */}
      <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        <Stat k="Total at work" v={loading ? '—' : fmt(totalWorking)} />
        <Stat k="Net vs deposit" v={loading ? '—' : `${totalPnl >= 0 ? '+' : ''}${fmt(totalPnl)}`} tone={totalPnl > 0 ? 'up' : totalPnl < 0 ? 'down' : undefined} />
        <Stat k="Deposited" v={loading ? '—' : fmt(totalDeposited)} />
        <Stat k="Pools" v={loading ? '—' : String(positions.length)} />
      </div>

      {/* 3b · coins held */}
      <div className="mt-4"><V1WalletCoins address={address ?? undefined} /></div>

      {/* 4 · positions */}
      <div className="flex items-center justify-between mt-7 mb-3">
        <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>Your positions</div>
        <Link href="/v1" className="text-[13px] font-semibold no-underline" style={{ color: '#8A82F4' }}>+ Add to a pool</Link>
      </div>

      {loading ? (
        <div className="rounded-[16px] p-6 text-[14px]" style={{ ...CARD, color: '#9B9BAD' }}>Loading your positions…</div>
      ) : positions.length === 0 ? (
        <div className="rounded-[16px] p-6 text-[13.5px]" style={{ ...CARD, color: '#9B9BAD' }}>
          Nothing working yet.{' '}
          <Link href="/v1" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Pick a pool →</Link>{' '}
          — your deposit is deployed as liquidity and earns trading fees, compounded back in.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {positions.map((p) => <PositionCard key={p.poolAddress} p={p} />)}
        </div>
      )}

      <Foot />
    </div>
  )
}

function PositionCard({ p }: { p: PoolPosition }) {
  const pnl = num(p.unrealizedPnlAtomic)
  const { base, quote } = pairParts(p.pairLabel)
  const label = (p.pairLabel || p.poolAddress).replace(/\s*\d[\d.]*\s*%\s*$/, '')
  return (
    <div className="rounded-[16px] p-5 max-[640px]:p-4" style={CARD}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href={`/earn/${slugOf(p)}`} className="flex items-center gap-2.5 no-underline min-w-0" style={{ color: '#F4F4FA' }}>
          <TokenPair baseLogo={null} quoteLogo={null} baseSymbol={base} quoteSymbol={quote} size={26} ring="#12121C" />
          <span className="font-semibold text-[15.5px] truncate">{label} <span style={{ color: '#8A82F4' }}>›</span></span>
        </Link>
        <span className="flex items-center gap-2 shrink-0">
          {p.source === 'env-fallback' && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: '#F0B45E', background: 'rgba(240,180,94,0.12)' }}>Dev rig</span>}
          {p.recorded === false && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full" title="Read from chain; the deposit was never recorded here, so cost basis is unknown." style={{ color: '#F0B45E', background: 'rgba(240,180,94,0.12)' }}>Unrecorded</span>}
          {(p.valueSeries?.length ?? 0) >= 3 && <Sparkline series={p.valueSeries} width={80} height={26} />}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>Value</div>
          <div className="font-mono font-bold text-[18px] mt-1">{usdg(p.positionValueAtomic)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>Net vs deposit</div>
          <div className="font-mono font-bold text-[18px] mt-1" style={{ color: p.costBasisAtomic == null ? '#63636F' : pnl >= 0 ? '#34D399' : '#F0736E' }}>{p.costBasisAtomic == null ? '—' : `${pnl >= 0 ? '+' : ''}${usdg(p.unrealizedPnlAtomic)}`}</div>
        </div>
      </div>
    </div>
  )
}

function Socials({ socials }: { socials?: { twitter?: string | null; farcaster?: string | null; telegram?: string | null; website?: string | null } }) {
  if (!socials) return null
  const items: [string, string][] = []
  if (socials.twitter) items.push(['X', `https://x.com/${socials.twitter.replace(/^@/, '')}`])
  if (socials.farcaster) items.push(['Farcaster', `https://warpcast.com/${socials.farcaster.replace(/^@/, '')}`])
  if (socials.telegram) items.push(['Telegram', `https://t.me/${socials.telegram.replace(/^@/, '')}`])
  if (socials.website) items.push(['Website', socials.website.startsWith('http') ? socials.website : `https://${socials.website}`])
  if (items.length === 0) return null
  return (
    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
      {items.map(([label, href]) => (
        <a key={label} href={href} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full no-underline" style={{ color: '#9B9BAD', background: 'rgba(255,255,255,0.05)' }}>{label} ↗</a>
      ))}
    </div>
  )
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-[14px] p-4" style={CARD}>
      <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>{k}</div>
      <div className="font-mono font-bold text-[20px] mt-1.5" style={{ color: tone === 'up' ? '#34D399' : tone === 'down' ? '#F0736E' : '#F4F4FA' }}>{v}</div>
    </div>
  )
}

function Step({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="flex gap-3">
      <span className="font-mono text-[12px] font-bold shrink-0" style={{ color: '#8A82F4' }}>{n}</span>
      <span>
        <span className="font-semibold text-[13.5px]">{t}</span>
        <div className="text-[12.5px] mt-0.5 leading-[1.5]" style={{ color: '#9B9BAD' }}>{d}</div>
      </span>
    </div>
  )
}

function Header() {
  return (
    <>
      <div className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#8A82F4' }}>Portfolio</div>
      <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5">Your liquid account</h1>
    </>
  )
}

function Foot() {
  return (
    <p className="text-[12px] mt-6" style={{ color: '#63636F' }}>
      Robinhood testnet · positions and values are read from chain (the dashboard record only adds cost basis).{' '}
      <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
    </p>
  )
}

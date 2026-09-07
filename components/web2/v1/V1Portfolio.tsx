'use client'

// Portfolio — the V1 account/profile surface. Three sections: (1) identity (avatar + name + bio + socials,
// borrowed from the V2 profile via useProfileMeta), (2) wallet (address + connection + total working
// value), (3) LP positions ACROSS pools (the /api/gateway/positions aggregate — one card per pool). Dark
// app skin. Honest: real chain-derived figures only, no fabricated numbers; the spendable buffer stays
// owner-gated (per-pool signature reveal).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useProfileMeta } from '@/lib/rewards/useProfileMeta'
import { useGatewayBuffer } from '@/components/web2/v1/useGatewayBuffer'
import { shortAddr } from '@/lib/web2/api'

type PoolPosition = {
  poolAddress: string
  pairLabel: string | null
  shares: string
  positionValueAtomic: string | null
  costBasisAtomic: string | null
  unrealizedPnlAtomic: string | null
}

const CARD = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }
const INNER = { background: '#0E0E16', border: '1px solid rgba(255,255,255,0.06)' }

const usdg = (a: string | null | undefined) => (a == null ? '$0.00' : `$${(Number(BigInt(a)) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const num = (a: string | null | undefined) => (a == null ? 0 : Number(BigInt(a)) / 1e6)
const slugOf = (p: PoolPosition) => encodeURIComponent((p.pairLabel || p.poolAddress).replace(/\s*\/\s*/g, '-').toLowerCase())

export function V1Portfolio() {
  const { address, isConnected, walletType, disconnect } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const connect = () => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })
  const { meta } = useProfileMeta(address)
  const [positions, setPositions] = useState<PoolPosition[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

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

  const name = meta?.displayName || meta?.basename || (address ? shortAddr(address) : '')
  const avatarLetter = address ? address.charAt(2).toUpperCase() : '?'
  const copyAddr = async () => {
    if (!address) return
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }

  if (!isConnected) {
    return (
      <div>
        <Header />
        <div className="mt-6 rounded-[16px] p-8 flex flex-col items-start gap-4" style={CARD}>
          <p className="text-[15px] max-w-[44ch] leading-[1.55]" style={{ color: '#9B9BAD' }}>Connect your wallet to see your profile, positions, and spendable buffer.</p>
          <button onClick={connect} className="text-[13.5px] font-semibold px-5 py-2.5 rounded-full text-white cursor-pointer" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', boxShadow: '0 4px 14px rgba(108,108,240,0.35)' }}>Connect Wallet</button>
        </div>
        <Foot />
      </div>
    )
  }

  return (
    <div>
      <Header />

      {/* 1 · identity + wallet */}
      <div className="mt-6 rounded-[16px] p-6 max-[640px]:p-5" style={CARD}>
        <div className="flex items-start gap-4 flex-wrap">
          <span className="w-[60px] h-[60px] rounded-full overflow-hidden flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }}>
            {meta?.avatar?.ref ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meta.avatar.ref} alt={name} width={60} height={60} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
            ) : (
              <span className="font-bold text-[24px] text-white">{avatarLetter}</span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-atx-display font-semibold text-[20px] tracking-[-0.02em] truncate">{name}</span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ color: '#9B9BAD', background: 'rgba(255,255,255,0.06)' }}>{walletType === 'privy-embedded' ? 'Embedded' : 'External'}</span>
            </div>
            {meta?.bio && <p className="text-[13.5px] mt-1.5 leading-[1.55] max-w-[52ch]" style={{ color: '#9B9BAD' }}>{meta.bio}</p>}
            <Socials socials={meta?.socials} />
            {/* wallet row */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <button onClick={copyAddr} className="inline-flex items-center gap-1.5 font-mono text-[12.5px] px-2.5 py-1.5 rounded-[10px] cursor-pointer" style={INNER} title="Copy address">
                <span style={{ color: '#9B9BAD' }}>{address ? shortAddr(address) : ''}</span>
                <span style={{ color: copied ? '#34D399' : '#63636F' }}>{copied ? '✓' : '⧉'}</span>
              </button>
              <Link href="/app/account" className="text-[12.5px] no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Edit profile ↗</Link>
              <button onClick={disconnect} className="text-[12.5px] font-semibold cursor-pointer" style={{ color: '#63636F' }}>Disconnect</button>
            </div>
          </div>
          {/* portfolio total */}
          <div className="text-right shrink-0 max-[560px]:text-left max-[560px]:w-full max-[560px]:mt-2">
            <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>Working & earning</div>
            <div className="font-mono font-bold text-[26px] tracking-[-0.02em]">{loading ? '—' : usdg(String(BigInt(Math.round(totalWorking * 1e6))))}</div>
            {totalPnl !== 0 && (
              <div className="text-[12.5px] font-mono font-semibold" style={{ color: totalPnl >= 0 ? '#34D399' : '#F0736E' }}>{totalPnl >= 0 ? '+' : ''}${Math.abs(totalPnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} net</div>
            )}
          </div>
        </div>
      </div>

      {/* 2 · positions across pools */}
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
          — it starts earning immediately, and your spendable buffer fills from the yield.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {positions.map((p) => <PositionCard key={p.poolAddress} p={p} address={address ?? undefined} />)}
        </div>
      )}

      <Foot />
    </div>
  )
}

function PositionCard({ p, address }: { p: PoolPosition; address?: string }) {
  const { buffer: bufAtomic, revealed, revealing, reveal } = useGatewayBuffer(address, p.poolAddress)
  const pnl = num(p.unrealizedPnlAtomic)
  const label = (p.pairLabel || p.poolAddress).replace(/\s*\d[\d.]*\s*%\s*$/, '')
  return (
    <div className="rounded-[16px] p-5 max-[640px]:p-4" style={CARD}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href={`/earn/${slugOf(p)}`} className="font-semibold text-[15.5px] no-underline" style={{ color: '#F4F4FA' }}>{label} <span style={{ color: '#8A82F4' }}>›</span></Link>
        {p.costBasisAtomic != null && (
          <span className="font-mono text-[12.5px] font-semibold" style={{ color: pnl >= 0 ? '#34D399' : '#F0736E' }}>{pnl >= 0 ? '+' : ''}{usdg(p.unrealizedPnlAtomic)} <span style={{ color: '#63636F', fontWeight: 400 }}>net</span></span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>Position value</div>
          <div className="font-mono font-bold text-[19px] mt-1">{usdg(p.positionValueAtomic)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>Spendable buffer</div>
          {revealed ? (
            <div className="font-mono font-bold text-[19px] mt-1" style={{ color: '#34D399' }}>{usdg(bufAtomic)}</div>
          ) : (
            <button onClick={reveal} disabled={revealing} className="font-mono font-bold text-[15px] mt-1 cursor-pointer disabled:cursor-default text-left" style={{ color: '#8A82F4' }}>{revealing ? 'Verifying…' : 'Verify to view →'}</button>
          )}
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
      Robinhood testnet · position values are chain-derived; your spendable buffer is private (owner-signed reveal).{' '}
      <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
    </p>
  )
}

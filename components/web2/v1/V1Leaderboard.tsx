'use client'

// Leaderboard — V1 "Season 0". Ranks OBSERVABLE activity only: capital at work (net USDG provided across
// pools) and referrals brought. Never a trust/credit signal or the Attribution score. Testnet: standings
// are illustrative and may reset — stated up front. Sticky "your rank" row (the top engagement pattern
// from Hyperliquid/dYdX). Dark app skin.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

type Provider = { rank: number; wallet: string; label: string; capitalAtomic: string; pools: number }
type Referrer = { rank: number; wallet: string; label: string; referrals: number; sharingScore: number }
type Board = 'providers' | 'referrers'

const CARD = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }
const usdg = (a: string) => { try { const n = Number(BigInt(a)) / 1e6; return n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}` } catch { return '$0' } }
const rankColor = (r: number) => (r === 1 ? '#F0C55E' : r === 2 ? '#C9C6FF' : r === 3 ? '#F0A183' : '#63636F')

export function V1Leaderboard() {
  const { address } = useMintwareIdentity()
  const [providers, setProviders] = useState<Provider[]>([])
  const [referrers, setReferrers] = useState<Referrer[]>([])
  const [me, setMe] = useState<{ provider: (Provider & { rank: number }) | null; referrer: (Referrer & { rank: number }) | null } | null>(null)
  const [board, setBoard] = useState<Board>('providers')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/gateway/leaderboard${address ? `?me=${address}` : ''}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) return
        setProviders(d.providers ?? [])
        setReferrers(d.referrers ?? [])
        setMe(d.me ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [address])

  const rows = board === 'providers' ? providers : referrers
  const myRow = board === 'providers' ? me?.provider : me?.referrer
  const cols = board === 'providers' ? '0.5fr 1.6fr 1fr 0.7fr' : '0.5fr 1.6fr 1fr 1fr'

  const totalCapital = useMemo(() => providers.reduce((s, p) => { try { return s + Number(BigInt(p.capitalAtomic)) / 1e6 } catch { return s } }, 0), [providers])

  return (
    <div>
      {/* hero */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#8A82F4' }}>Leaderboard</div>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ color: '#8A82F4', background: 'rgba(138,130,244,0.12)', border: '1px solid rgba(138,130,244,0.2)' }}>Season 0 · Testnet</span>
      </div>
      <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5">
        Who&rsquo;s putting USDG to work
      </h1>
      <p className="text-[14px] leading-[1.6] mt-3 max-w-[58ch]" style={{ color: '#9B9BAD' }}>
        Ranked on real, observable activity — capital at work and referrals brought.{' '}
        <span style={{ color: '#F0B45E' }}>Season 0 is testnet: standings are illustrative and may reset. Not a promise of rewards.</span>
      </p>

      {/* board tabs */}
      <div className="flex gap-1.5 mt-7">
        {([['providers', 'Providers'], ['referrers', 'Referrers']] as [Board, string][]).map(([b, label]) => (
          <button key={b} onClick={() => setBoard(b)} className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold cursor-pointer transition-colors" style={board === b ? { background: 'rgba(255,255,255,0.09)', color: '#F4F4FA' } : { color: '#9B9BAD' }}>{label}</button>
        ))}
      </div>

      {/* your rank */}
      {myRow && (
        <div className="mt-4 rounded-[14px] px-5 py-3.5 grid items-center" style={{ ...CARD, gridTemplateColumns: cols, borderLeft: '2px solid #8A82F4' }}>
          <span className="font-mono font-bold text-[15px]" style={{ color: '#8A82F4' }}>#{myRow.rank}</span>
          <span className="font-semibold text-[14px]">You <span className="font-mono text-[12px]" style={{ color: '#63636F' }}>{myRow.label}</span></span>
          {board === 'providers' ? (
            <><span className="text-right font-mono text-[14px]">{usdg((myRow as Provider).capitalAtomic)}</span><span className="text-right font-mono text-[13px]" style={{ color: '#9B9BAD' }}>{(myRow as Provider).pools}</span></>
          ) : (
            <><span className="text-right font-mono text-[14px]">{(myRow as Referrer).referrals}</span><span className="text-right font-mono text-[13px]" style={{ color: '#9B9BAD' }}>{(myRow as Referrer).sharingScore}</span></>
          )}
        </div>
      )}

      {/* table */}
      <div className="mt-3 rounded-[16px] overflow-x-auto" style={CARD}>
        <div className="grid items-center px-5 py-3 text-[11px] uppercase tracking-[0.07em] font-semibold min-w-[520px]" style={{ gridTemplateColumns: cols, color: '#63636F', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span>#</span>
          <span>{board === 'providers' ? 'Provider' : 'Referrer'}</span>
          <span className="text-right">{board === 'providers' ? 'Capital at work' : 'Referrals'}</span>
          <span className="text-right">{board === 'providers' ? 'Pools' : 'Sharing'}</span>
        </div>

        {loading ? (
          <Msg>Loading standings…</Msg>
        ) : rows.length === 0 ? (
          <Msg>
            No one on this board yet — Season 0 just opened. {board === 'providers' ? 'Put USDG to work' : 'Share your referral link'} to be the first.{' '}
            <Link href={board === 'providers' ? '/v1' : '/v1/referrals'} className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>{board === 'providers' ? 'Pick a pool →' : 'Get your link →'}</Link>
          </Msg>
        ) : (
          rows.map((row) => {
            const isMe = address && row.wallet === address.toLowerCase()
            return (
              <div key={row.wallet} className="grid items-center px-5 py-3.5 min-w-[520px]" style={{ gridTemplateColumns: cols, borderBottom: '1px solid rgba(255,255,255,0.05)', background: isMe ? 'rgba(138,130,244,0.06)' : 'transparent' }}>
                <span className="font-mono font-bold text-[14px]" style={{ color: rankColor(row.rank) }}>#{row.rank}</span>
                <span className="font-mono text-[13.5px] truncate" style={{ color: isMe ? '#C9C6FF' : '#F4F4FA' }}>{row.label}{isMe && <span className="ml-2 text-[11px] font-sans font-semibold" style={{ color: '#8A82F4' }}>you</span>}</span>
                {board === 'providers' ? (
                  <><span className="text-right font-mono text-[14px] font-semibold">{usdg((row as Provider).capitalAtomic)}</span><span className="text-right font-mono text-[13px]" style={{ color: '#9B9BAD' }}>{(row as Provider).pools}</span></>
                ) : (
                  <><span className="text-right font-mono text-[14px] font-semibold">{(row as Referrer).referrals}</span><span className="text-right font-mono text-[13px]" style={{ color: '#9B9BAD' }}>{(row as Referrer).sharingScore}</span></>
                )}
              </div>
            )
          })
        )}
      </div>

      <p className="text-[12px] mt-5" style={{ color: '#63636F' }}>
        Robinhood testnet · Season 0 · ranks observable activity only (capital at work · referrals) — never a
        trust or credit score. {board === 'providers' && totalCapital > 0 ? `${usdg(String(BigInt(Math.round(totalCapital * 1e6))))} at work across the board. ` : ''}Standings are illustrative and may reset.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-8 text-[14px]" style={{ color: '#9B9BAD' }}>{children}</div>
}

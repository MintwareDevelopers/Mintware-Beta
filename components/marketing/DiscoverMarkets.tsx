'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Pool = { poolAddress: string; pairLabel: string; baseSymbol: string; quoteSymbol: string; tvlUsd: number; vol24Usd: number; live: boolean }
type Props = { mode: 'proof' | 'top' | 'list' }
const slug = (pool: Pool) => encodeURIComponent(pool.poolAddress.toLowerCase())
const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`

export function DiscoverMarkets({ mode }: Props) {
  const [pools, setPools] = useState<Pool[] | null>(null)
  useEffect(() => {
    fetch('/api/gateway/discover').then(r => r.json()).then(d => {
      setPools(d?.success && Array.isArray(d.pools) ? d.pools : [])
    }).catch(() => setPools([]))
  }, [])
  if (pools === null) return null
  if (!pools.length) return mode === 'list' ? <Link href="/app/markets" className="mw-btn-quiet">Browse live markets in the app →</Link> : null
  if (mode === 'proof') {
    const live = pools.filter(p => p.live).length
    return live ? <span>{live} curated markets</span> : null
  }
  // The ranked feed is shown as-is; each row is labeled Live or Curating by its real status.
  const ranked = [...pools].sort((a, b) => b.vol24Usd - a.vol24Usd)
  const shown = ranked.slice(0, mode === 'top' ? 3 : 8)
  if (mode === 'top') return <span className="inline-flex flex-wrap gap-2">{shown.map(p => <Link key={p.poolAddress} href={`/app/markets/${slug(p)}`} className="mw-raise-sm rounded-full px-3 py-1.5 text-[13px] text-ink-mid no-underline hover:text-ink">{p.baseSymbol} / {p.quoteSymbol}</Link>)}</span>
  return <div className="grid md:grid-cols-2 gap-3">{shown.map((p, i) => <Link key={p.poolAddress} href={`/app/markets/${slug(p)}`} className="mw-raise-sm mw-lift flex items-center gap-4 rounded-[18px] p-4 no-underline text-ink">
    <span className="flex-none w-11 h-11 rounded-full grid place-items-center text-[12px] font-bold" style={{ background: 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', boxShadow: 'inset 0 1px 0 #fff', color: '#2E2BA8' }}>{p.baseSymbol.slice(0, 2)}</span>
    <span className="flex-1 min-w-0"><span className="block font-semibold truncate">{p.baseSymbol} / {p.quoteSymbol}</span>
      <span className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: p.live ? 'var(--mw-gain)' : 'var(--mw-ink-3)' }}><span className={`w-1.5 h-1.5 rounded-full ${p.live ? '' : 'mw-tex-dots'}`} style={{ background: p.live ? '#22A45D' : '#C9C0F4' }} />{p.live ? 'Live' : 'Curating'}</span></span>
    <span className="text-right text-[12px] text-ink-soft"><span className="block font-geist-mono text-[13px] text-ink">{money(p.vol24Usd)}</span><span className="block mt-0.5">vol · {money(p.tvlUsd)} TVL</span></span>
    <span className="sr-only">Rank {i + 1}</span></Link>)}</div>
}

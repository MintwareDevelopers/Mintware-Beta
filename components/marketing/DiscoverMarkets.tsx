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
  if (!pools.length) return mode === 'list' ? <Link href="/v1" className="text-peri-deep font-semibold no-underline hover:underline">Browse live markets in the app →</Link> : null
  if (mode === 'proof') {
    const live = pools.filter(p => p.live).length
    return live ? <span>{live} curated markets</span> : null
  }
  // The ranked feed is shown as-is; each row is labeled Live or Curating by its real status.
  const ranked = [...pools].sort((a, b) => b.vol24Usd - a.vol24Usd)
  const shown = ranked.slice(0, mode === 'top' ? 3 : 8)
  if (mode === 'top') return <span className="inline-flex flex-wrap gap-2">{shown.map(p => <Link key={p.poolAddress} href={`/markets/${slug(p)}`} className="rounded-full border border-hair px-3 py-1.5 text-[13px] text-ink-mid no-underline hover:text-ink">{p.baseSymbol} / {p.quoteSymbol}</Link>)}</span>
  return <div className="grid md:grid-cols-2 gap-3">{shown.map((p, i) => <Link key={p.poolAddress} href={`/markets/${slug(p)}`} className="flex items-center justify-between gap-4 rounded-xl border border-hair p-4 no-underline text-ink hover:shadow-card"><span><span className="block font-semibold">{p.baseSymbol} / {p.quoteSymbol}</span><span className="block text-[12px] text-ink-mid mt-1">{p.live ? 'Live' : 'Curating'} · {p.pairLabel}</span></span><span className="text-right text-[12px] text-ink-mid"><span className="block">{money(p.vol24Usd)} vol</span><span className="block mt-1">{money(p.tvlUsd)} TVL</span></span><span className="sr-only">Rank {i + 1}</span></Link>)}</div>
}

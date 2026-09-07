'use client'

// Discover — the V1 app home (Meteora-style): a scannable table of the hottest Robinhood-Chain pools
// that pass our criteria, live from /api/gateway/discover (real GeckoTerminal metrics + our risk score).
// Live-depositable pools link to /earn/[pool]; the rest show as "Curating" (screened, not yet live).
// Dark app skin. Honest — real metrics only (TVL / 24h vol / activity), no APY/guaranteed framing.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Pool = {
  poolAddress: string
  pairLabel: string
  tvlUsd: number
  vol24Usd: number
  volTvlRatio: number | null
  poolAgeDays: number | null
  riskScore: number
  reasons: string[]
  live: boolean
}

type Tab = 'all' | 'live' | 'new'

const usd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`
const slug = (p: Pool) => encodeURIComponent((p.pairLabel || p.poolAddress).replace(/\s*\/\s*/g, '-').toLowerCase())

function risk(score: number): { label: string; color: string } {
  if (score < 20) return { label: 'Low', color: '#34D399' }
  if (score < 50) return { label: 'Med', color: '#F0B45E' }
  return { label: 'High', color: '#F0736E' }
}

const COLS = '1.8fr 1fr 1fr 0.9fr 1.1fr 1.1fr'

export function V1Discover() {
  const [pools, setPools] = useState<Pool[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')

  useEffect(() => {
    fetch('/api/gateway/discover')
      .then((r) => r.json())
      .then((d) => setPools(d?.success && Array.isArray(d.pools) ? (d.pools as Pool[]) : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const shown = useMemo(() => {
    if (tab === 'live') return pools.filter((p) => p.live)
    if (tab === 'new') return pools.filter((p) => p.poolAgeDays != null && p.poolAgeDays < 7)
    return pools
  }, [pools, tab])

  const totalTvl = pools.reduce((s, p) => s + p.tvlUsd, 0)
  const totalVol = pools.reduce((s, p) => s + p.vol24Usd, 0)

  return (
    <div>
      {/* hero */}
      <div className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#8A82F4' }}>Earn · Robinhood Chain</div>
      <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5 max-w-[26ch]">
        Put USDG to work in curated pools —{' '}
        <span style={{ backgroundImage: 'linear-gradient(100deg,#8A82F4,#F0A183)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>spend from the yield.</span>
      </h1>
      <p className="text-[14.5px] leading-[1.6] mt-3 max-w-[58ch]" style={{ color: '#9B9BAD' }}>
        Deposit USDG. It earns while staged, then provides liquidity to a pool we&rsquo;ve screened — and a
        liquid buffer stays spendable. You spend the yield, never your position.
      </p>

      {/* stats strip */}
      <div className="flex gap-8 mt-6 flex-wrap">
        <Stat k="Pools screened" v={loading ? '—' : String(pools.length)} />
        <Stat k="Total TVL" v={loading ? '—' : usd(totalTvl)} />
        <Stat k="24h Volume" v={loading ? '—' : usd(totalVol)} />
        <Stat k="Network" v="Robinhood Testnet" />
      </div>

      {/* tabs */}
      <div className="flex gap-1.5 mt-7">
        {([['all', 'All'], ['live', 'Live'], ['new', 'New']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold cursor-pointer transition-colors"
            style={tab === t ? { background: 'rgba(255,255,255,0.09)', color: '#F4F4FA' } : { color: '#9B9BAD' }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* table */}
      <div className="mt-3 rounded-[16px] overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: '#12121C' }}>
        <div className="grid items-center px-5 py-3 text-[11px] uppercase tracking-[0.07em] font-semibold"
          style={{ gridTemplateColumns: COLS, color: '#63636F', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span>Pool</span>
          <span className="text-right">24h Vol</span>
          <span className="text-right">TVL</span>
          <span className="text-right max-[820px]:hidden">Activity</span>
          <span className="text-center">Trust</span>
          <span className="text-right">&nbsp;</span>
        </div>

        {loading ? (
          <Msg>Loading pools…</Msg>
        ) : shown.length === 0 ? (
          <Msg>
            No pools match yet. We&rsquo;re screening the hottest Robinhood Chain pools — they appear here as
            they clear our criteria.
          </Msg>
        ) : (
          shown.map((p) => {
            const r = risk(p.riskScore)
            const row = (
              <>
                <span className="flex items-center gap-3 min-w-0">
                  <span className="w-8 h-8 rounded-full shrink-0" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }} />
                  <span className="min-w-0">
                    <span className="font-semibold text-[15px] truncate block">{p.pairLabel || short(p.poolAddress)}</span>
                    <span className="font-mono text-[11px]" style={{ color: '#63636F' }}>{short(p.poolAddress)}</span>
                  </span>
                </span>
                <span className="text-right font-mono text-[14px]">{usd(p.vol24Usd)}</span>
                <span className="text-right font-mono text-[14px]">{usd(p.tvlUsd)}</span>
                <span className="text-right font-mono text-[13.5px] max-[820px]:hidden" style={{ color: '#9B9BAD' }}>
                  {p.volTvlRatio != null ? `${p.volTvlRatio.toFixed(1)}×` : '—'}
                </span>
                <span className="flex justify-center">
                  <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: r.color, background: `${r.color}1A` }}>
                    {r.label} · {p.riskScore}
                  </span>
                </span>
                <span className="text-right">
                  {p.live ? (
                    <span className="text-[13.5px] font-semibold" style={{ color: '#8A82F4' }}>Deposit USDG →</span>
                  ) : (
                    <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ color: '#9B9BAD', background: 'rgba(255,255,255,0.05)' }}>Curating</span>
                  )}
                </span>
              </>
            )
            const cls = 'grid items-center px-5 py-4'
            const style = { gridTemplateColumns: COLS, color: '#F4F4FA', borderBottom: '1px solid rgba(255,255,255,0.05)' }
            return p.live ? (
              <Link
                key={p.poolAddress}
                href={`/earn/${slug(p)}`}
                className={`${cls} no-underline transition-colors`}
                style={style}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {row}
              </Link>
            ) : (
              <div key={p.poolAddress} className={cls} style={style}>{row}</div>
            )
          })
        )}
      </div>

      <p className="text-[12px] mt-5 leading-[1.55] max-w-[76ch]" style={{ color: '#63636F' }}>
        Live metrics from GeckoTerminal; the risk score ranks the queue, it does not certify safety — every
        pool is a human curation decision. In testing on Robinhood Chain — testnet, not yet audited. A
        liquidity position is not a deposit or a guaranteed return and is subject to impermanent loss.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>{k}</div>
      <div className="font-mono font-bold text-[16px] mt-1">{v}</div>
    </div>
  )
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-8 text-[14px]" style={{ color: '#9B9BAD' }}>{children}</div>
}

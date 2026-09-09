'use client'

// Discover — the V1 app home (Meteora × Krystal parity): a scannable table of the hottest Robinhood-Chain
// pools that pass our screen, live from /api/gateway/discover (real GeckoTerminal metrics + our risk score).
// Real paired token icons, 24h price-trend sparklines, est. fee APR, sortable columns, and a curated
// "screened picks" spotlight. Every row → /earn/[pool]; live pools are depositable, the rest are "Curating".
// Honest: real metrics only, est. APR labeled an estimate, no APY/guaranteed framing; the score ranks,
// humans curate.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { TokenPair } from '@/components/web2/v1/TokenPair'
import { Sparkline } from '@/components/web2/v1/Sparkline'

type Pool = {
  poolAddress: string
  pairLabel: string
  tvlUsd: number
  vol24Usd: number
  volTvlRatio: number | null
  poolAgeDays: number | null
  riskScore: number
  reasons: string[]
  baseSymbol: string
  quoteSymbol: string
  baseLogo: string | null
  quoteLogo: string | null
  feePct: number | null
  estFeeAprPct: number | null
  live: boolean
}

type Tab = 'all' | 'live' | 'new'
type SortKey = 'vol' | 'apr' | 'tvl' | 'activity' | 'trust'

const usd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`
// Audit O-2 / HO-2: /earn/[pool] is keyed by the pool's registry id (the 20-/32-byte v4 poolId from
// GeckoTerminal), NEVER the pair label — a label slug could not match the registry and every page fell
// back to the single env gateway. The label is display-only.
const slug = (p: Pool) => encodeURIComponent(p.poolAddress.toLowerCase())
// est. fee APR: big meme-pool numbers read like Krystal/Meteora (9,307%); small ones keep a decimal.
const aprFmt = (n: number | null) => (n == null ? '—' : n >= 1000 ? `${Math.round(n).toLocaleString('en-US')}%` : `${n.toFixed(1)}%`)
// strip the trailing fee off the GeckoTerminal name so the row shows a clean pair; the fee gets its own chip.
const pairName = (p: Pool) => (p.baseSymbol && p.quoteSymbol ? `${p.baseSymbol} / ${p.quoteSymbol}` : (p.pairLabel || short(p.poolAddress)).replace(/\s*\d[\d.]*\s*%\s*$/, ''))
// Earnings simulator: est. fees/yr on a deposit = amount × pool fee-APR (earn-vs-lp decision: 100% of a
// deposit is deployed as liquidity — no held-back reserve). Matches the /earn/[pool] page math. An estimate
// off the trailing-24h fee rate, gross of impermanent loss — never a promise.
const projFeesYr = (p: Pool, amount: number) => (p.estFeeAprPct != null && amount > 0 ? amount * (p.estFeeAprPct / 100) : null)
const projFmt = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`)

function risk(score: number): { label: string; color: string } {
  if (score < 20) return { label: 'Low', color: '#34D399' }
  if (score < 50) return { label: 'Med', color: '#F0B45E' }
  return { label: 'High', color: '#F0736E' }
}

const sortVal = (p: Pool, k: SortKey): number => {
  if (k === 'apr') return p.estFeeAprPct ?? -1
  if (k === 'tvl') return p.tvlUsd
  if (k === 'activity') return p.volTvlRatio ?? -1
  if (k === 'trust') return -p.riskScore // lower risk first
  return p.vol24Usd
}
const SORTS: [SortKey, string][] = [['vol', '24h Vol'], ['apr', 'Est. APR'], ['tvl', 'TVL'], ['activity', 'Activity'], ['trust', 'Trust']]

const COLS = '1.9fr 0.85fr 0.85fr 0.85fr 0.85fr 0.7fr 0.9fr 0.9fr'

export function V1Discover() {
  const [pools, setPools] = useState<Pool[]>([])
  const [series, setSeries] = useState<Record<string, number[]>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [sortKey, setSortKey] = useState<SortKey>('vol')
  const [simStr, setSimStr] = useState('1,000') // earnings-simulator deposit amount (USDG)
  const sim = Number(simStr.replace(/[^0-9.]/g, '')) || 0

  useEffect(() => {
    fetch('/api/gateway/discover')
      .then((r) => r.json())
      .then((d) => setPools(d?.success && Array.isArray(d.pools) ? (d.pools as Pool[]) : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Sparklines are fetched separately (own 15-min cache) once we know which pools are on screen.
  const addrKey = pools.map((p) => p.poolAddress).join(',')
  useEffect(() => {
    if (!addrKey) return
    fetch(`/api/gateway/sparklines?pools=${encodeURIComponent(addrKey)}`)
      .then((r) => r.json())
      .then((d) => setSeries(d?.success && d.series ? d.series : {}))
      .catch(() => {})
  }, [addrKey])

  const shown = useMemo(() => {
    let list = pools
    if (tab === 'live') list = list.filter((p) => p.live)
    else if (tab === 'new') list = list.filter((p) => p.poolAgeDays != null && p.poolAgeDays < 7)
    return [...list].sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || sortVal(b, sortKey) - sortVal(a, sortKey))
  }, [pools, tab, sortKey])

  // Curated "screened picks" spotlight (Krystal's bucket pattern): the lowest-risk, most-established of the
  // feed — a different lens than the hot-by-volume table. Live pools always float to the front.
  const spotlight = useMemo(() => {
    const score = (p: Pool) => (p.live ? 1e6 : 0) + (100 - p.riskScore) + Math.min(p.tvlUsd / 1e6, 10)
    return [...pools].sort((a, b) => score(b) - score(a)).slice(0, 3)
  }, [pools])

  const totalTvl = pools.reduce((s, p) => s + p.tvlUsd, 0)
  const totalVol = pools.reduce((s, p) => s + p.vol24Usd, 0)

  return (
    <div>
      {/* hero */}
      <div className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#8A82F4' }}>Earn · Robinhood Chain</div>
      <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5 max-w-[26ch]">
        Put USDG to work in curated pools —{' '}
        <span style={{ backgroundImage: 'linear-gradient(100deg,#8A82F4,#F0A183)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>never locked.</span>
      </h1>
      <p className="text-[14.5px] leading-[1.6] mt-3 max-w-[58ch]" style={{ color: '#9B9BAD' }}>
        Deposit USDG — your full deposit is paired into a pool we&rsquo;ve screened and earns trading fees,
        compounded back into your position. Withdraw anytime for both legs.
      </p>

      {/* stats strip */}
      <div className="flex gap-8 mt-6 flex-wrap">
        <Stat k="Pools screened" v={loading ? '—' : String(pools.length)} />
        <Stat k="Total TVL" v={loading ? '—' : usd(totalTvl)} />
        <Stat k="24h Volume" v={loading ? '—' : usd(totalVol)} />
        <Stat k="Network" v="Robinhood Testnet" />
      </div>

      {/* spotlight — curated screened picks */}
      {!loading && spotlight.length > 0 && (
        <div className="mt-7">
          <div className="text-[11px] uppercase tracking-[0.08em] font-semibold mb-2.5" style={{ color: '#63636F' }}>
            Screened picks <span style={{ color: '#4A4A55' }}>· lowest-risk, most-established of the feed</span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
            {spotlight.map((p) => {
              const r = risk(p.riskScore)
              return (
                <Link
                  key={p.poolAddress}
                  href={`/earn/${slug(p)}`}
                  className="rounded-[14px] p-4 no-underline transition-transform hover:-translate-y-0.5"
                  style={{ background: '#12121C', border: '1px solid rgba(255,255,255,0.07)', color: '#F4F4FA', display: 'block' }}
                >
                  <div className="flex items-center gap-2.5">
                    <TokenPair baseLogo={p.baseLogo} quoteLogo={p.quoteLogo} baseSymbol={p.baseSymbol} quoteSymbol={p.quoteSymbol} size={26} ring="#12121C" />
                    <span className="font-semibold text-[14px] truncate">{pairName(p)}</span>
                    <span className="ml-auto text-[10.5px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={p.live ? { color: '#34D399', background: 'rgba(52,211,153,0.14)' } : { color: r.color, background: `${r.color}1A` }}>
                      {p.live ? 'Live' : r.label}
                    </span>
                  </div>
                  <div className="flex items-end justify-between mt-3">
                    <div>
                      <div className="font-mono font-bold text-[19px]" style={{ color: p.estFeeAprPct != null ? '#34D399' : '#F4F4FA' }}>{aprFmt(p.estFeeAprPct)}</div>
                      <div className="text-[10px] uppercase tracking-[0.05em] font-semibold" style={{ color: '#63636F' }}>Est. Fee APR</div>
                      {(() => { const y = projFeesYr(p, sim); return y != null ? <div className="font-mono text-[11px] mt-1" style={{ color: '#7E7E8C' }}>≈ {projFmt(y)}/yr on ${simStr}</div> : null })()}
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[13px]">{usd(p.tvlUsd)}</div>
                      <div className="text-[10px] uppercase tracking-[0.05em] font-semibold" style={{ color: '#63636F' }}>TVL</div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* controls: tabs + sort */}
      <div className="flex items-center justify-between gap-3 mt-7 flex-wrap">
        <div className="flex gap-1.5">
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.06em] font-semibold mr-0.5" style={{ color: '#63636F' }}>Sort</span>
          {SORTS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className="px-2.5 py-1 max-[640px]:py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-colors"
              style={sortKey === k ? { background: 'rgba(138,130,244,0.16)', color: '#C9C6FF' } : { color: '#9B9BAD' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* quality-filter note (Krystal's "showing pools ≥…" honesty line) */}
      <div className="text-[11.5px] mt-2.5" style={{ color: '#4A4A55' }}>
        Showing screened <span style={{ color: '#63636F' }}>Uniswap v4 · USDG-quoted</span> pools, risk-ranked — never auto-approved.
      </div>

      {/* earnings simulator */}
      <div className="mt-4 rounded-[12px] px-4 py-3 flex items-center gap-x-3 gap-y-2 flex-wrap" style={{ background: '#12121C', border: '1px solid rgba(138,130,244,0.2)' }}>
        <span className="text-[12.5px] font-semibold" style={{ color: '#C9C6FF' }}>Earnings simulator</span>
        <span className="text-[13px]" style={{ color: '#9B9BAD' }}>If I deposit</span>
        <span className="inline-flex items-center rounded-[10px] px-2.5 py-1.5" style={{ background: '#0E0E16', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span className="mr-1 text-[13px]" style={{ color: '#63636F' }}>$</span>
          <input
            inputMode="decimal"
            aria-label="Deposit amount to simulate"
            value={simStr}
            onChange={(e) => setSimStr(e.target.value.replace(/[^0-9.,]/g, ''))}
            className="bg-transparent outline-none font-mono font-semibold text-[14.5px] w-[84px]"
            style={{ color: '#F4F4FA' }}
          />
          <span className="ml-1 text-[12px]" style={{ color: '#63636F' }}>USDG</span>
        </span>
        <div className="flex gap-1.5">
          {['100', '1,000', '10,000'].map((v) => (
            <button
              key={v}
              onClick={() => setSimStr(v)}
              className="px-2.5 py-1 max-[640px]:py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-colors"
              style={simStr.replace(/[^0-9.]/g, '') === v.replace(/[^0-9.]/g, '') ? { background: 'rgba(138,130,244,0.16)', color: '#C9C6FF' } : { color: '#9B9BAD' }}
            >
              ${v}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] max-[720px]:w-full min-[721px]:ml-auto" style={{ color: '#4A4A55' }}>
          → est. fees/yr per pool below · once fully deployed, gross of IL · an estimate, not a projection
        </span>
      </div>

      {/* table */}
      {/* the wide table keeps its columns and scrolls inside its own rounded box on mobile — the page never
          scrolls sideways, and the Pool identity column stays readable (min-w floor + horizontal scroll) */}
      <div className="mt-3 rounded-[16px] overflow-x-auto" style={{ border: '1px solid rgba(255,255,255,0.07)', background: '#12121C' }}>
        <div className="grid items-center px-5 py-3 text-[11px] uppercase tracking-[0.07em] font-semibold min-w-[840px]"
          style={{ gridTemplateColumns: COLS, color: '#63636F', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span>Pool</span>
          <span className="text-center">24h Trend</span>
          <span className="text-right">Est. APR</span>
          <span className="text-right">24h Vol</span>
          <span className="text-right">TVL</span>
          <span className="text-right">Activity</span>
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
            return (
              <Link
                key={p.poolAddress}
                href={`/earn/${slug(p)}`}
                className="grid items-center px-5 py-4 no-underline transition-colors min-w-[840px]"
                style={{ gridTemplateColumns: COLS, color: '#F4F4FA', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <TokenPair baseLogo={p.baseLogo} quoteLogo={p.quoteLogo} baseSymbol={p.baseSymbol} quoteSymbol={p.quoteSymbol} ring="#12121C" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-[15px] truncate">{pairName(p)}</span>
                      {p.feePct != null && (
                        <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-[6px] shrink-0" style={{ color: '#9B9BAD', background: 'rgba(255,255,255,0.06)' }}>{p.feePct}%</span>
                      )}
                    </span>
                    <span className="font-mono text-[11px]" style={{ color: '#63636F' }}>{short(p.poolAddress)}</span>
                  </span>
                </span>
                <span className="flex justify-center"><Sparkline series={series[p.poolAddress]} /></span>
                <span className="text-right leading-tight">
                  <span className="font-mono text-[14px] font-semibold block" style={{ color: p.estFeeAprPct != null ? '#34D399' : '#63636F' }}>{aprFmt(p.estFeeAprPct)}</span>
                  {(() => { const y = projFeesYr(p, sim); return y != null ? <span className="font-mono text-[11px] block mt-0.5" style={{ color: '#7E7E8C' }}>≈ {projFmt(y)}/yr</span> : null })()}
                </span>
                <span className="text-right font-mono text-[14px]">{usd(p.vol24Usd)}</span>
                <span className="text-right font-mono text-[14px]">{usd(p.tvlUsd)}</span>
                <span className="text-right font-mono text-[13.5px]" style={{ color: '#9B9BAD' }}>
                  {p.volTvlRatio != null ? `${p.volTvlRatio.toFixed(1)}×` : '—'}
                </span>
                <span className="flex justify-center">
                  <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: r.color, background: `${r.color}1A` }}>
                    {r.label} · {p.riskScore}
                  </span>
                </span>
                <span className="text-right whitespace-nowrap">
                  {p.live ? (
                    <span className="text-[13.5px] font-semibold" style={{ color: '#8A82F4' }}>Deposit →</span>
                  ) : (
                    <span className="text-[12px] font-semibold" style={{ color: '#63636F' }}>Curating <span style={{ color: '#8A82F4' }}>›</span></span>
                  )}
                </span>
              </Link>
            )
          })
        )}
      </div>

      <p className="text-[12px] mt-5" style={{ color: '#63636F' }}>
        Robinhood testnet · metrics live from GeckoTerminal · est. APR = trailing-24h fees ÷ TVL, annualized
        (an estimate, not a projection) · the score ranks, humans curate.{' '}
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

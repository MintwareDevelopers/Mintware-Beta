'use client'

// Markets — the V1 app home, in two clearly separated parts:
//   1. Live markets: our MarketEngine markets (Base + Robinhood testnets), from the on-chain-verified
//      registry via /api/gateway/markets. These accept deposits.
//   2. Watchlist: the real Robinhood-mainnet pools we screen (live GeckoTerminal metrics + our risk score
//      via /api/gateway/discover), with sparklines, est. fee APR, sortable columns and screened picks.
//      Markets open on these after the audited mainnet launch.
// Honest: real metrics only, est. APR labeled an estimate, no APY/guaranteed framing; the score ranks,
// humans curate.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { GlassFrame } from './GlassFrame'
import { TokenPair } from '@/components/web2/v1/TokenPair'
import { Sparkline } from '@/components/web2/v1/Sparkline'
import { marketChain } from '@/lib/chains/marketChains'
import type { LiveMarket } from '@/app/api/gateway/markets/route'

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

type Tab = 'all' | 'new'
type SortKey = 'vol' | 'apr' | 'tvl' | 'activity' | 'trust'

const usd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`
const slug = (p: Pool) => encodeURIComponent(p.poolAddress.toLowerCase())
// est. fee APR: big meme-pool numbers read like Krystal/Meteora (9,307%); small ones keep a decimal.
const aprFmt = (n: number | null) => (n == null ? '—' : n >= 1000 ? `${Math.round(n).toLocaleString('en-US')}%` : `${n.toFixed(1)}%`)
// strip the trailing fee off the GeckoTerminal name so the row shows a clean pair; the fee gets its own chip.
const pairName = (p: Pool) => (p.baseSymbol && p.quoteSymbol ? `${p.baseSymbol} / ${p.quoteSymbol}` : (p.pairLabel || short(p.poolAddress)).replace(/\s*\d[\d.]*\s*%\s*$/, ''))
// Earnings simulator: est. fees/yr on a deposit = amount × pool fee-APR. An estimate
// off the trailing-24h fee rate, gross of impermanent loss — never a promise.
const projFeesYr = (p: Pool, amount: number) => (p.estFeeAprPct != null && amount > 0 ? amount * (p.estFeeAprPct / 100) : null)
const projFmt = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`)

function risk(score: number): { label: string; color: string } {
  if (score < 20) return { label: 'Low', color: '#0F7A43' }
  if (score < 50) return { label: 'Med', color: '#8A5300' }
  return { label: 'High', color: '#B42318' }
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
  const [markets, setMarkets] = useState<LiveMarket[] | null>(null)
  const [series, setSeries] = useState<Record<string, number[]>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [sortKey, setSortKey] = useState<SortKey>('vol')
  const [simStr, setSimStr] = useState('1,000') // earnings-simulator deposit amount (USDG)
  const sim = Number(simStr.replace(/[^0-9.]/g, '')) || 0

  useEffect(() => {
    fetch('/api/gateway/markets')
      .then((r) => r.json())
      .then((d) => setMarkets(d?.success && Array.isArray(d.markets) ? (d.markets as LiveMarket[]) : []))
      .catch(() => setMarkets([]))
  }, [])

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
    if (tab === 'new') list = list.filter((p) => p.poolAgeDays != null && p.poolAgeDays < 7)
    return [...list].sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || sortVal(b, sortKey) - sortVal(a, sortKey))
  }, [pools, tab, sortKey])

  // Curated "screened picks" spotlight (Krystal's bucket pattern): the lowest-risk, most-established of the
  // feed — a different lens than the hot-by-volume table. Live pools always float to the front.
  const spotlight = useMemo(() => {
    const score = (p: Pool) => (p.live ? 1e6 : 0) + (100 - p.riskScore) + Math.min(p.tvlUsd / 1e6, 10)
    return [...pools].sort((a, b) => score(b) - score(a)).slice(0, 3)
  }, [pools])

  const totalVol = pools.reduce((s, p) => s + p.vol24Usd, 0)
  const liveNav = (markets ?? []).reduce((s, m) => s + (m.navQuote ?? 0), 0)
  const liveChains = [...new Set((markets ?? []).map((m) => marketChain(m.chainId)?.short ?? `Chain ${m.chainId}`))]

  return (
    <div>
      {/* hero */}
      <div className="text-[12.5px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#4643D1' }}>Markets · Base + Robinhood</div>
      <h1 className="font-geist font-semibold tracking-[-0.04em] leading-[1.04] text-[clamp(2rem,4vw,3rem)] mt-2.5 max-w-[24ch]">
        Put your tokens to work in curated markets —{' '}
        <span style={{ color: '#62626F' }}>never locked.</span>
      </h1>
      <p className="text-[15.5px] leading-[1.6] mt-3 max-w-[58ch]" style={{ color: '#454552' }}>
        Add one or both pool tokens to a curated MarketEngine. Your shares track a quote-valued pool portfolio;
        withdraw pro-rata in both tokens.
      </p>

      {/* stats strip */}
      <div className="grid gap-4 mt-7" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        <Stat k="Live markets" v={markets == null ? '—' : String(markets.length)} />
        <Stat k="Live market value" v={markets == null ? '—' : `${liveNav.toLocaleString('en-US', { maximumFractionDigits: 0 })} test USD`} />
        <Stat k="Live on" v={markets == null ? '—' : liveChains.length ? liveChains.join(' · ') : 'Testnets'} />
        <Stat k="Watchlist 24h volume" v={loading ? '—' : usd(totalVol)} />
      </div>

      {/* LIVE MARKETS — ours, on-chain, depositable (testnets) */}
      <SectionHead
        title="Live markets"
        tag="Testnet"
        sub="Mintware markets running today. Deposit one or both tokens, withdraw pro-rata any time."
      />
      {markets == null ? (
        <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
          {[0, 1].map((i) => <div key={i} className="h-[132px] rounded-[14px] mw-shimmer" />)}
        </div>
      ) : markets.length === 0 ? (
        <div className="mt-3 rounded-[14px] px-5 py-6 text-[13.5px]" style={{ ...CARD, color: '#454552' }}>
          No market is open right now. New markets open here as each one is deployed and verified on-chain.
        </div>
      ) : (
        <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
          {markets.map((mk) => <LiveMarketCard key={`${mk.chainId}:${mk.poolAddress}`} m={mk} />)}
        </div>
      )}

      {/* WATCHLIST — real mainnet pools we screen */}
      <SectionHead
        title="Watchlist"
        tag="Robinhood mainnet"
        sub="Real pools we screen on depth, age and trading. Markets open on these after the audited mainnet launch."
      />

      {/* spotlight — curated screened picks */}
      {!loading && spotlight.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-[0.08em] font-semibold mb-2.5" style={{ color: '#62626F' }}>
            Screened picks <span style={{ color: '#62626F' }}>· lowest-risk, most-established of the feed</span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
            {spotlight.map((p) => {
              const r = risk(p.riskScore)
              return (
                <Link
                  key={p.poolAddress}
                  href={`/app/markets/${slug(p)}?pair=${encodeURIComponent(p.pairLabel)}`}
                  className="rounded-[14px] p-4 no-underline transition-transform hover:-translate-y-0.5"
                  style={{ background: '#FFFFFF', border: '1px solid rgba(22,22,44,0.08)', boxShadow: '0 1px 2px rgba(20,20,50,0.04), 0 8px 24px -12px rgba(30,30,80,0.10)', color: '#15151D', display: 'block' }}
                >
                  <div className="flex items-center gap-2.5">
                    <TokenPair baseLogo={p.baseLogo} quoteLogo={p.quoteLogo} baseSymbol={p.baseSymbol} quoteSymbol={p.quoteSymbol} size={26} ring="#FFFFFF" />
                    <span className="font-semibold text-[14px] truncate">{pairName(p)}</span>
                    <span className="ml-auto text-[10.5px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={p.live ? { color: '#0F7A43', background: 'rgba(22,163,74,0.14)' } : { color: r.color, background: `${r.color}1A` }}>
                      {p.live ? 'Live' : r.label}
                    </span>
                  </div>
                  <div className="flex items-end justify-between mt-3">
                    <div>
                      {/* No fee field upstream ⇒ lead with real 24h volume instead of an empty APR. */}
                      <div className="font-mono font-bold text-[19px]" style={{ color: p.estFeeAprPct != null ? '#0F7A43' : '#15151D' }}>{p.estFeeAprPct != null ? aprFmt(p.estFeeAprPct) : usd(p.vol24Usd)}</div>
                      <div className="text-[10px] uppercase tracking-[0.05em] font-semibold" style={{ color: '#62626F' }}>{p.estFeeAprPct != null ? 'Est. Fee APR' : '24h Volume'}</div>
                      {(() => { const y = projFeesYr(p, sim); return y != null ? <div className="font-mono text-[11px] mt-1" style={{ color: '#5A5A66' }}>≈ {projFmt(y)}/yr on ${simStr}</div> : null })()}
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[13px]">{usd(p.tvlUsd)}</div>
                      <div className="text-[10px] uppercase tracking-[0.05em] font-semibold" style={{ color: '#62626F' }}>TVL</div>
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
          {([['all', 'All'], ['new', 'New']] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold cursor-pointer transition-colors"
              style={tab === t ? { background: 'rgba(22,22,44,0.09)', color: '#15151D' } : { color: '#454552' }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.06em] font-semibold mr-0.5" style={{ color: '#62626F' }}>Sort</span>
          {SORTS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className="px-2.5 py-1 max-[640px]:py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-colors"
              style={sortKey === k ? { background: 'rgba(138,130,244,0.16)', color: '#4C4CD6' } : { color: '#454552' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* quality-filter note (Krystal's "showing pools ≥…" honesty line) */}
      <div className="text-[11.5px] mt-2.5" style={{ color: '#62626F' }}>
        Showing screened <span style={{ color: '#62626F' }}>Uniswap v4 · USDG-quoted</span> pools, risk-ranked — never auto-approved.
      </div>

      {/* earnings simulator */}
      <div className="mt-4 rounded-[12px] px-4 py-3 flex items-center gap-x-3 gap-y-2 flex-wrap" style={{ background: 'rgba(255,255,255,0.62)', border: '1px solid rgba(138,130,244,0.2)' }}>
        <span className="text-[12.5px] font-semibold" style={{ color: '#4C4CD6' }}>Earnings simulator</span>
        <span className="text-[13px]" style={{ color: '#454552' }}>If I deposit</span>
        <span className="inline-flex items-center rounded-[10px] px-2.5 py-1.5" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(22,22,44,0.1)' }}>
          <span className="mr-1 text-[13px]" style={{ color: '#62626F' }}>$</span>
          <input
            inputMode="decimal"
            aria-label="Deposit amount to simulate"
            value={simStr}
            onChange={(e) => setSimStr(e.target.value.replace(/[^0-9.,]/g, ''))}
            className="bg-transparent outline-none font-mono font-semibold text-[14.5px] w-[84px]"
            style={{ color: '#15151D' }}
          />
          <span className="ml-1 text-[12px]" style={{ color: '#62626F' }}>USDG</span>
        </span>
        <div className="flex gap-1.5">
          {['100', '1,000', '10,000'].map((v) => (
            <button
              key={v}
              onClick={() => setSimStr(v)}
              className="px-2.5 py-1 max-[640px]:py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-colors"
              style={simStr.replace(/[^0-9.]/g, '') === v.replace(/[^0-9.]/g, '') ? { background: 'rgba(138,130,244,0.16)', color: '#4C4CD6' } : { color: '#454552' }}
            >
              ${v}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] max-[720px]:w-full min-[721px]:ml-auto" style={{ color: '#62626F' }}>
          → est. fees/yr per pool below · once fully deployed, gross of IL · an estimate, not a projection
        </span>
      </div>

      {/* table */}
      {/* the wide table keeps its columns and scrolls inside its own rounded box on mobile — the page never
          scrolls sideways, and the Pool identity column stays readable (min-w floor + horizontal scroll) */}
      <GlassFrame className="mt-3" innerClassName="overflow-x-auto">
        <div className="grid items-center px-5 py-3 text-[11px] uppercase tracking-[0.07em] font-semibold min-w-[840px]"
          style={{ gridTemplateColumns: COLS, color: '#62626F', borderBottom: '1px solid rgba(22,22,44,0.06)' }}>
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
                href={`/app/markets/${slug(p)}?pair=${encodeURIComponent(p.pairLabel)}`}
                className="grid items-center px-5 py-4 no-underline transition-colors min-w-[840px]"
                style={{ gridTemplateColumns: COLS, color: '#15151D', borderBottom: '1px solid rgba(22,22,44,0.05)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(22,22,44,0.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <TokenPair baseLogo={p.baseLogo} quoteLogo={p.quoteLogo} baseSymbol={p.baseSymbol} quoteSymbol={p.quoteSymbol} ring="#FFFFFF" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-[15px] truncate">{pairName(p)}</span>
                      {p.feePct != null && (
                        <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-[6px] shrink-0" style={{ color: '#454552', background: 'rgba(22,22,44,0.06)' }}>{p.feePct}%</span>
                      )}
                    </span>
                    <span className="font-mono text-[11px]" style={{ color: '#62626F' }}>{short(p.poolAddress)}</span>
                  </span>
                </span>
                <span className="flex justify-center"><Sparkline series={series[p.poolAddress]} /></span>
                <span className="text-right leading-tight">
                  <span className="font-mono text-[14px] font-semibold block" style={{ color: p.estFeeAprPct != null ? '#0F7A43' : '#62626F' }}>{aprFmt(p.estFeeAprPct)}</span>
                  {(() => { const y = projFeesYr(p, sim); return y != null ? <span className="font-mono text-[11px] block mt-0.5" style={{ color: '#5A5A66' }}>≈ {projFmt(y)}/yr</span> : null })()}
                </span>
                <span className="text-right font-mono text-[14px]">{usd(p.vol24Usd)}</span>
                <span className="text-right font-mono text-[14px]">{usd(p.tvlUsd)}</span>
                <span className="text-right font-mono text-[13.5px]" style={{ color: '#454552' }}>
                  {p.volTvlRatio != null ? `${p.volTvlRatio.toFixed(1)}×` : '—'}
                </span>
                <span className="flex justify-center">
                  <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ color: r.color, background: `${r.color}1A` }}>
                    {r.label}{p.riskScore > 0 ? ` · ${p.riskScore}` : ''}
                  </span>
                </span>
                <span className="text-right whitespace-nowrap">
                  {p.live ? (
                    <span className="text-[13.5px] font-semibold" style={{ color: '#4643D1' }}>Deposit →</span>
                  ) : (
                    <span className="text-[12px] font-semibold" style={{ color: '#62626F' }}>Curating <span style={{ color: '#4643D1' }}>›</span></span>
                  )}
                </span>
              </Link>
            )
          })
        )}
      </GlassFrame>

      <p className="text-[12px] mt-5" style={{ color: '#62626F' }}>
        Live markets read from chain (testnets, test tokens) · watchlist metrics live from GeckoTerminal (Robinhood mainnet) · est. APR = trailing-24h fees ÷ TVL, annualized
        (an estimate, not a projection) · the score ranks, humans curate.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#4643D1', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

const CARD = { background: '#FFFFFF', boxShadow: 'var(--mw-raise)' }

function SectionHead({ title, tag, sub }: { title: string; tag: string; sub: string }) {
  return (
    <div className="mt-9">
      <div className="flex items-center gap-2.5 flex-wrap">
        <h2 className="font-geist font-semibold text-[19px] tracking-[-0.02em]">{title}</h2>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full" style={{ color: '#4643D1', background: 'rgba(138,130,244,0.14)' }}>{tag}</span>
      </div>
      <p className="text-[13px] mt-1" style={{ color: '#5A5A66' }}>{sub}</p>
    </div>
  )
}

function LiveMarketCard({ m }: { m: LiveMarket }) {
  const chain = marketChain(m.chainId)
  const pair = m.pairLabel ?? `${m.poolAddress.slice(0, 8)}…`
  const [base, quote] = pair.split('/').map((x) => x.trim())
  return (
    <Link
      href={`/app/markets/${encodeURIComponent(m.poolAddress)}?pair=${encodeURIComponent(pair)}`}
      className="block rounded-[14px] p-4 no-underline transition-transform hover:-translate-y-0.5"
      style={{ ...CARD, color: '#15151D' }}
    >
      <div className="flex items-center gap-2.5">
        <TokenPair baseLogo={null} quoteLogo={null} baseSymbol={base ?? pair} quoteSymbol={quote ?? ''} size={28} ring="#FFFFFF" />
        <span className="font-semibold text-[15px] truncate">{pair}</span>
        <span className="ml-auto text-[10.5px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ color: '#0F7A43', background: 'rgba(22,163,74,0.12)' }}>● Live</span>
      </div>
      <div className="flex items-end justify-between mt-4">
        <div>
          <div className="font-mono font-bold text-[20px]">{m.navQuote == null ? 'Reading…' : m.navQuote.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
          <div className="text-[10px] uppercase tracking-[0.05em] font-semibold" style={{ color: '#62626F' }}>Market value{m.quoteSymbol ? ` · ${m.quoteSymbol}` : ''}</div>
        </div>
        <div className="text-right">
          <div className="text-[12.5px] font-semibold">{chain?.short ?? `Chain ${m.chainId}`}</div>
          <div className="text-[10px] uppercase tracking-[0.05em] font-semibold" style={{ color: '#62626F' }}>{m.feePct != null ? `${m.feePct}% fee · ` : ''}testnet</div>
        </div>
      </div>
      <div className="mt-3 pt-3 text-[12.5px] font-semibold flex justify-between" style={{ borderTop: '1px solid rgba(22,22,44,0.06)', color: '#4643D1' }}>
        <span>{m.depositable ? 'Deposit or withdraw' : 'View market'}</span><span>→</span>
      </div>
    </Link>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="mw-raise rounded-[20px] px-[clamp(14px,2vw,22px)] py-[clamp(14px,2vw,20px)] min-w-0">
      <div className="text-[13px]" style={{ color: '#62626F' }}>{k}</div>
      <div className="font-mono font-medium text-[clamp(18px,2.4vw,26px)] tracking-[-0.03em] mt-2 leading-[1.15] break-words">{v}</div>
    </div>
  )
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-8 text-[14px]" style={{ color: '#454552' }}>{children}</div>
}

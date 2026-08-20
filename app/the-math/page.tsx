'use client'

// /the-math — "The Math": one simple question, answered with live data.
// What does a liquidity pool BACKED BY USDC earn vs one BACKED BY ETH?
// Two columns. Each side = a real idle-yield floor (USDC lending vs ETH staking) + real swap
// fees (a stable pair vs an ETH pair), pulled live from DefiLlama (see /api/benchmarks/yields):
// real APY (fee/supply only), real TVL, 30-day averages, sourced + dated. The striking, honest
// takeaway: ETH-backed pools earn FAR more in fees (higher fee tier + volume) but carry IL + ETH
// price risk; USDC-backed pools earn less but stay dollar-stable. Light-only, platform design.

import { useEffect, useMemo, useState } from 'react'
import { MwNav } from '@/components/web2/MwNav'

const fmtUsd = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M'
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K'
  return '$' + Math.round(n).toLocaleString()
}
const money = (n: number) => '$' + Math.round(n).toLocaleString()
const pct = (n: number | null | undefined) => (n == null ? '—' : (n >= 100 ? n.toFixed(0) : n.toFixed(2)) + '%')

type Row = {
  key: string; side: 'usdc' | 'eth'; layer: 'floor' | 'fees'; label: string; blurb: string
  riskNote: string | null; chain: string; symbol: string
  apyBase: number | null; apyMean30d: number | null; apyReward: number | null
  tvlUsd: number; volumeUsd1d: number | null; stablecoin: boolean; ilRisk: string
}
type Feed = { ok: true; source: string; sourceUrl: string; asOf: string; rows: Row[] } | { ok: false }

export default function TheMath() {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [dep, setDep] = useState(25_000)

  useEffect(() => {
    let alive = true
    fetch('/api/benchmarks/yields')
      .then(r => r.json())
      .then(d => { if (alive) setFeed(d) })
      .catch(() => { if (alive) setFeed({ ok: false }) })
    return () => { alive = false }
  }, [])

  const rows = feed?.ok ? feed.rows : []
  const get = (side: 'usdc' | 'eth', layer: 'floor' | 'fees') => rows.find(r => r.side === side && r.layer === layer) ?? null
  const asOf = feed?.ok ? new Date(feed.asOf) : null

  const sides = useMemo(() => (['usdc', 'eth'] as const).map(side => {
    const floor = get(side, 'floor')
    const fees = get(side, 'fees')
    const floorApy = floor?.apyMean30d ?? floor?.apyBase ?? null
    const feesApy = fees?.apyMean30d ?? fees?.apyBase ?? null
    const total = (floorApy ?? 0) + (feesApy ?? 0)
    return { side, floor, fees, floorApy, feesApy, total }
  }), [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const usdc = sides[0]
  const eth = sides[1]

  return (
    <div className="min-h-screen bg-white font-atx-display text-ink">
      <MwNav />
      <main className="mx-auto max-w-[980px] px-6 max-[700px]:px-4 py-[40px]">
        <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display">
          The math · backing a pool
        </div>
        <h1 className="font-atx-display font-bold text-[clamp(1.9rem,4.7vw,3rem)] leading-[1.04] tracking-[-0.03em] mt-2.5">
          Back a pool with USDC<br />or with <span className="text-gradient-accent">ETH?</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1rem,2vw,1.14rem)] leading-[1.5] max-w-[62ch] mt-3.5">
          Same idea, two assets. Your capital earns a <b className="text-ink">floor</b> just sitting idle
          (lending for USDC, staking for ETH) <i>and</i> <b className="text-ink">swap fees</b> when it backs
          liquidity. The two assets earn very differently — here it is, side by side, on live rates.
        </p>

        {/* deposit control */}
        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <span className="text-[11.5px] font-semibold tracking-[0.1em] uppercase text-ink-soft">On a deposit of</span>
          <div className="inline-flex items-center gap-1.5">
            {[10_000, 25_000, 100_000, 500_000].map(v => (
              <button key={v} onClick={() => setDep(v)}
                className={`glass-pill px-[13px] py-[7px] text-[13px] font-semibold cursor-pointer ${dep === v ? 'text-white' : 'text-ink-mid'}`}
                style={dep === v ? { background: 'linear-gradient(135deg,var(--color-peri),var(--color-peri-deep))' } : {}}>
                {fmtUsd(v)}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-ink-soft">· one year</span>
        </div>

        {/* source line */}
        <div className="mt-4 text-[12px] text-ink-soft flex items-center gap-2 flex-wrap">
          {feed == null && <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-peri)] animate-pulse" />Loading live rates…</span>}
          {feed?.ok && asOf && <>Live from <a href={feed.sourceUrl} target="_blank" rel="noreferrer" className="text-peri-deep font-semibold underline underline-offset-2">DefiLlama</a> · as of {asOf.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · rates are <b className="text-ink-mid">30-day averages</b>, fee/supply only</>}
          {feed?.ok === false && <span className="text-[var(--color-coral2-deep)]">Couldn’t load live rates right now — refresh to retry.</span>}
        </div>

        {/* two columns */}
        <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-4 mt-5">
          <SideCard s={usdc} dep={dep} loading={feed == null}
            title="USDC-backed" sub="A dollar-stable pool" accent="var(--color-peri)"
            tint="rgba(108,108,240,.07)" />
          <SideCard s={eth} dep={dep} loading={feed == null}
            title="ETH-backed" sub="An ETH-denominated pool" accent="var(--color-coral2-deep)"
            tint="rgba(232,138,103,.09)" />
        </div>

        {/* takeaway */}
        {feed?.ok && usdc.feesApy != null && eth.feesApy != null && (
          <div className="mt-4 rounded-[12px] px-4 py-3.5 text-[13.5px] text-ink leading-[1.5]" style={{ background: 'var(--color-ground-cool)', border: '1px solid var(--color-hair)' }}>
            <b>The trade-off.</b> ETH-backed pools earn far more in <b>fees</b> — <b style={{ color: 'var(--color-coral2-deep)' }}>{pct(eth.feesApy)}</b> vs USDC’s
            <b style={{ color: 'var(--color-peri-deep)' }}> {pct(usdc.feesApy)}</b> — because ETH pairs trade at a higher fee tier with far more volume, where stable pairs sit at 1bp.
            But that ETH fee income comes with <b>impermanent loss and ETH price risk</b>; the USDC side is lower-yield and <b>dollar-stable</b>. USDC’s floor is also higher
            (lending {pct(usdc.floorApy)} vs staking {pct(eth.floorApy)}). Pick the risk you want.
          </div>
        )}

        {/* where mintware fits — kept short */}
        <h2 className="font-atx-display font-bold text-[clamp(1.2rem,2.6vw,1.55rem)] tracking-[-0.02em] mt-10 mb-2.5">Where Mintware changes the picture</h2>
        <div className="grid grid-cols-3 max-[720px]:grid-cols-1 gap-3">
          {[
            { t: 'Floor + fees, same dollar', d: 'Idle capital earns the floor (lending/staking) and the same capital is JIT-pulled to earn swap fees — not one or the other. Both columns’ numbers stack instead of choosing.' },
            { t: 'Keeps the ETH-side fees', d: 'The ETH side’s big fees normally bleed to impermanent loss and arbitrage. JIT (short exposure) + MEV recapture are built to keep more of them — the point of the volatile column.' },
            { t: 'Still spendable', d: 'Whichever asset backs it, the balance stays usable as USDC (cards / x402 / settlement) while it earns. Never idle, never locked.' },
          ].map(c => (
            <div key={c.t} className="soft-card p-[16px]">
              <h4 className="font-atx-display m-0 mb-1.5 text-[14px] font-semibold tracking-[-0.01em]">{c.t}</h4>
              <p className="m-0 text-[12.5px] text-ink-mid leading-[1.5]">{c.d}</p>
            </div>
          ))}
        </div>

        <p className="text-[11.5px] text-ink-soft leading-[1.6] max-w-[82ch] mt-7">
          <b className="text-ink-mid">What’s real and what’s not.</b> The floor and fee rates are live pools from DefiLlama — 30-day-average APY (fee/supply
          component only, token-reward bribes excluded), real TVL; rates move, so the numbers change on reload. Each “pool total” is simply that side’s floor + fees;
          for the ETH side it is a <b className="text-ink-mid">gross</b> figure — real impermanent loss and ETH price moves reduce what you keep, which is exactly the
          risk the column is highlighting. The “Where Mintware fits” claims describe mechanisms that are <b className="text-ink-mid">built but on Base Sepolia testnet,
          unaudited, and empty</b> — external audit gates real value; JIT wins on deep/high-volume pools and can lose on thin ones. Crypto yield is taxable income;
          this is not investment or tax advice.
        </p>
      </main>
    </div>
  )
}

type SideData = { side: 'usdc' | 'eth'; floor: Row | null; fees: Row | null; floorApy: number | null; feesApy: number | null; total: number }

function SideCard({ s, dep, loading, title, sub, accent, tint }: { s: SideData; dep: number; loading: boolean; title: string; sub: string; accent: string; tint: string }) {
  if (loading) return <div className="soft-card p-5 h-[360px]"><div className="h-full rounded bg-ground-cool animate-pulse" /></div>
  return (
    <div className="soft-card p-5" style={{ background: `linear-gradient(180deg, ${tint}, transparent 60%)` }}>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="font-atx-display font-bold text-[19px] tracking-[-0.01em]" style={{ color: accent }}>{title}</div>
          <div className="text-[12px] text-ink-soft mt-0.5">{sub}</div>
        </div>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] rounded-full px-2 py-[3px]"
          style={{ color: accent, background: 'color-mix(in srgb,' + accent + ' 12%,transparent)' }}>
          {s.side === 'usdc' ? 'IL ≈ 0' : 'IL + price risk'}
        </span>
      </div>

      {/* total */}
      <div className="mt-4 pb-3.5 border-b border-hair-soft">
        <div className="text-[10.5px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Pool total{s.side === 'eth' ? ' (gross)' : ''}</div>
        <div className="font-atx-display font-bold text-[clamp(2.2rem,6vw,3rem)] leading-[.95] tracking-[-0.03em] num" style={{ color: accent }}>
          {pct(s.total)}
        </div>
        <div className="text-[12.5px] text-ink-mid num mt-0.5">≈ {money(dep * s.total / 100)} on {fmtUsd(dep)} / yr</div>
      </div>

      {/* breakdown */}
      <Layer label="Floor" sub={s.floor?.label} apy={s.floorApy} row={s.floor} accent={accent} />
      <Layer label="Swap fees" sub={s.fees?.label} apy={s.feesApy} row={s.fees} accent={accent} />
    </div>
  )
}

function Layer({ label, sub, apy, row, accent }: { label: string; sub?: string; apy: number | null; row: Row | null; accent: string }) {
  return (
    <div className="pt-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{label}</span>
        <span className="font-atx-display font-bold text-[17px] num" style={{ color: accent }}>{pct(apy)}</span>
      </div>
      {sub && <div className="text-[11.5px] text-ink-soft mt-0.5">{sub}{row ? <> · <span className="num">{fmtUsd(row.tvlUsd)}</span> TVL</> : ''}</div>}
      {row?.riskNote && <div className="text-[10.5px] text-ink-soft mt-1 leading-[1.4]">{row.riskNote}</div>}
    </div>
  )
}

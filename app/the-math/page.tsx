'use client'

// /the-math — "The Math": the yield-engine VISION. We sell where we're building TO, not just where
// we are today — but honestly. The hero is the target engine (best-of floor + JIT fees + MEV + an
// atomic ETH-fee slice → ~12–15% blended), framed as the destination. It's grounded, not vapor: the
// FLOOR is a live, real DefiLlama number today; the recipe is proven (Bunni hit ~13% on stables
// before an accounting bug ended them); and we're building it with the safety Bunni lacked. A clear,
// unmissable anchor states it's testnet today — the ~5–6% floor is live, the climb is the roadmap,
// not current returns. Below the vision, the live USDC-vs-ETH comparison stays as a proof section.
// Light-only, platform design system.

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

// The engine we're building. The floor is LIVE (real DefiLlama rate, wired below). The three activity
// layers are PROJECTED / testnet — illustrative contributions, not measured yield. Target range is the
// destination "at scale," when real volume drives the activity layers toward the top of their ranges.
const ENGINE = {
  fees: 3.5, // JIT-concentrated swap fees (projected)
  mev: 1.5,  // MEV recaptured to LPs — am-AMM / Diamond-LVR (projected)
  eth: 1.5,  // atomic flash-JIT ETH-fee slice (projected)
  targetLo: 12,
  targetHi: 15,
  floorFallback: 5.5, // shown only until live rates load
}

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
  const floorLive = usdc.floorApy // the live best-of USDC lending rate

  return (
    <div className="min-h-screen bg-white font-atx-display text-ink">
      <MwNav />
      <main className="mx-auto max-w-[1000px] px-6 max-[700px]:px-4 py-[40px]">

        {/* ── VISION HERO ─────────────────────────────────────────────── */}
        <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display">
          The yield engine we’re building
        </div>
        <h1 className="font-atx-display font-bold text-[clamp(2rem,5vw,3.2rem)] leading-[1.02] tracking-[-0.03em] mt-2.5">
          Never idle. Never locked.<br /><span className="text-gradient-accent">Always yours.</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1rem,2vw,1.18rem)] leading-[1.5] max-w-[60ch] mt-4">
          One dollar, doing three jobs — earning a lending <b className="text-ink">floor</b>, earning swap
          <b className="text-ink"> fees</b>, and <b className="text-ink">spendable</b> the whole time. We’re
          building toward a blended
          {' '}<span className="font-semibold text-peri-deep">{ENGINE.targetLo}–{ENGINE.targetHi}%</span>,
          fully liquid, self-custodied, and tranche-safe.
        </p>

        {/* the engine (target), floor live */}
        <div className="soft-card p-5 mt-6">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-ink-soft">The target blend</div>
              <div className="font-atx-display font-bold text-[clamp(2.6rem,7vw,3.6rem)] leading-[.92] tracking-[-0.03em] text-gradient-accent num mt-1">
                {ENGINE.targetLo}–{ENGINE.targetHi}<span className="text-[.34em] text-ink-soft font-semibold tracking-[-0.02em]"> %&nbsp;blended</span>
              </div>
            </div>
            <div className="text-[12.5px] text-ink-mid max-w-[30ch] pb-1.5">
              Built on a floor that’s <b className="text-ink">live today</b>
              {floorLive != null ? <> — a real <b className="text-peri-deep num">{pct(floorLive)}</b> best-of lending rate</> : <> — a real best-of lending rate</>}.
              The climb is the roadmap.
            </div>
          </div>
          <EngineBar floorLive={floorLive} loading={feed == null} />
        </div>

        {/* honest anchor — unmissable, not buried */}
        <div className="mt-4 rounded-[12px] px-4 py-3.5 text-[13px] text-ink leading-[1.5]"
          style={{ background: 'linear-gradient(110deg, rgba(244,161,131,.13), var(--color-ground-cool))', border: '1px solid color-mix(in srgb, var(--color-coral2-deep) 30%, transparent)' }}>
          <b>Where we are vs. where we’re going.</b> This is the destination. <b>Today it’s testnet and
          unaudited</b> — the <b>~{floorLive != null ? pct(floorLive) : '5–6%'} floor is live and verifiable</b>;
          the climb to {ENGINE.targetLo}–{ENGINE.targetHi}% is <b>projected activity yield</b> (fees + MEV + the
          ETH slice), earned only at scale with real volume. This is a roadmap, <b>not current returns, and not
          investment advice.</b>
        </div>

        {/* why it's grounded, not vapor */}
        <h2 className="font-atx-display font-bold text-[clamp(1.3rem,2.8vw,1.7rem)] tracking-[-0.02em] mt-10 mb-3">Grounded, not vapor</h2>
        <div className="grid grid-cols-3 max-[720px]:grid-cols-1 gap-3">
          {[
            { t: 'The floor is live today', d: <>The base of the engine — a best-of curated lending rate — is a <b className="text-ink">real, current number</b>{floorLive != null ? <> (<b className="text-peri-deep num">{pct(floorLive)}</b> right now, pinned to live data)</> : ''}. The foundation already works.</> },
            { t: 'The recipe is proven', d: <>Bunni hit <b className="text-ink">~13% on stablecoins</b> with this exact stack — rehypothecated floor + fees + MEV — before an accounting bug ended them. The yield isn’t theoretical.</> },
            { t: 'Built with the safety they lacked', d: <>Senior/junior tranches, <b className="text-ink">atomic (not leveraged)</b> capture, and conservation-audited accounting — the exact class of bug that took Bunni down, closed by invariant tests.</> },
          ].map(c => (
            <div key={c.t} className="soft-card p-[18px]">
              <h4 className="font-atx-display m-0 mb-1.5 text-[15px] font-semibold tracking-[-0.01em]">{c.t}</h4>
              <p className="m-0 text-[13px] text-ink-mid leading-[1.55]">{c.d}</p>
            </div>
          ))}
        </div>

        {/* the differentiator */}
        <div className="mt-4 rounded-[12px] px-4 py-3.5 text-[14px] text-ink leading-[1.5]" style={{ background: 'rgba(17,163,126,.10)', border: '1px solid color-mix(in srgb,#11a37e 26%,transparent)' }}>
          The number isn’t the story — the <b>combination</b> is: a yield in the low teens that stays
          <b style={{ color: '#11a37e' }}> liquid, spendable, and can’t rug you</b>. That beats a locked fund’s
          net, and it’s the thing a 20% leveraged farm or an emissions banner can’t offer.
        </div>

        {/* ── SUPPORTING: the live proof ──────────────────────────────── */}
        <div className="mt-11 pt-1 border-t border-hair-soft" />
        <h2 className="font-atx-display font-bold text-[clamp(1.3rem,2.8vw,1.7rem)] tracking-[-0.02em] mt-6 mb-2">Why ETH pairs matter — the live picture</h2>
        <p className="text-ink-mid text-[14.5px] leading-[1.5] max-w-[64ch] mb-4">
          The activity layers aren’t hand-waving. Here’s the real, current gap between a dollar-stable pool
          and an ETH pool — the fee opportunity the engine is built to harvest (as a hedged, bounded slice,
          not the raw headline).
        </p>

        {/* deposit control */}
        <div className="flex items-center gap-3 flex-wrap">
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
        <div className="mt-3 text-[12px] text-ink-soft flex items-center gap-2 flex-wrap">
          {feed == null && <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-peri)] animate-pulse" />Loading live rates…</span>}
          {feed?.ok && asOf && <>Live from <a href={feed.sourceUrl} target="_blank" rel="noreferrer" className="text-peri-deep font-semibold underline underline-offset-2">DefiLlama</a> · as of {asOf.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · 30-day averages, fee/supply only</>}
          {feed?.ok === false && <span className="text-[var(--color-coral2-deep)]">Couldn’t load live rates right now — refresh to retry.</span>}
        </div>

        {/* two columns */}
        <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-4 mt-4">
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
            <b>The gap the engine harvests.</b> ETH pools earn far more in <b>fees</b> — <b style={{ color: 'var(--color-coral2-deep)' }}>{pct(eth.feesApy)}</b> vs USDC’s
            <b style={{ color: 'var(--color-peri-deep)' }}> {pct(usdc.feesApy)}</b> — because ETH pairs trade at a higher fee tier with far more volume. That fee income
            normally bleeds to <b>impermanent loss</b>; the engine captures a <b>bounded, hedged slice</b> of it (atomic JIT) while your capital stays USDC-denominated —
            which is exactly the ETH slice in the target blend above.
          </div>
        )}

        <p className="text-[11.5px] text-ink-soft leading-[1.6] max-w-[84ch] mt-7">
          <b className="text-ink-mid">What’s real and what’s not.</b> The floor and fee rates in the comparison are live pools from DefiLlama — 30-day-average APY
          (fee/supply component only, token-reward bribes excluded), real TVL; rates move, so they change on reload. The <b className="text-ink-mid">{ENGINE.targetLo}–{ENGINE.targetHi}%
          target</b> is a <b className="text-ink-mid">projection</b>: the live floor plus projected activity yield (JIT fees + MEV recapture + a bounded atomic ETH-fee slice),
          earned only at scale with real volume. The vault stack is <b className="text-ink-mid">on Base Sepolia testnet, unaudited, and empty</b>; external audit gates real
          value; JIT wins on deep pools and can lose on thin ones. Crypto yield is taxable income; this is not investment or tax advice.
        </p>
      </main>
    </div>
  )
}

// ── The target engine bar: floor (live) + three projected activity layers ──────
function EngineBar({ floorLive, loading }: { floorLive: number | null; loading: boolean }) {
  const floor = floorLive ?? ENGINE.floorFallback
  const layers = [
    { name: 'Best-of floor', v: floor, tag: (floorLive != null ? 'live' : '~live'), color: 'var(--color-peri)', projected: false },
    { name: 'JIT fees', v: ENGINE.fees, tag: 'projected', color: 'var(--color-peri-mid)', projected: true },
    { name: 'MEV recapture', v: ENGINE.mev, tag: 'projected', color: '#2A9E8A', projected: true },
    { name: 'Atomic ETH slice', v: ENGINE.eth, tag: 'projected', color: 'var(--color-coral2-deep)', projected: true },
  ]
  const scale = ENGINE.targetHi + 1 // leave a little headroom so the bar doesn't max out
  const hatch = (c: string) => `repeating-linear-gradient(115deg, ${c} 0 7px, color-mix(in srgb, ${c} 55%, white) 7px 12px)`
  return (
    <div className="mt-5">
      <div className="flex h-[42px] rounded-[10px] overflow-hidden border border-hair" style={{ opacity: loading ? 0.5 : 1 }}>
        {layers.map(l => (
          <div key={l.name} title={`${l.name}: ${pct(l.v)} (${l.tag})`}
            className="flex items-center justify-center transition-[width] duration-300"
            style={{ width: (l.v / scale * 100) + '%', background: l.projected ? hatch(l.color) : l.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 mt-3 text-[11.5px] text-ink-mid">
        {layers.map(l => (
          <span key={l.name} className="inline-flex items-center gap-1.5">
            <i className="inline-block w-[11px] h-[11px] rounded-[3px]" style={{ background: l.projected ? hatch(l.color) : l.color }} />
            {l.name} <span className="text-ink font-semibold num">{pct(l.v)}</span>
            <span className={`text-[10px] font-semibold uppercase tracking-[0.05em] rounded-full px-1.5 py-[1px] ${l.projected ? 'text-ink-soft' : 'text-peri-deep'}`}
              style={{ background: l.projected ? 'var(--color-ground-cool)' : 'rgba(108,108,240,.12)' }}>{l.tag}</span>
          </span>
        ))}
      </div>
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

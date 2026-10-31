'use client'

// V2-RWAs visual building blocks — light-only. Every number comes from the live chain read (useRwaUnit) or
// the recorded proof run (lib/rwa/demo.ts); nothing here is decorative data.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { explorer, revertReasonText, shortHash, type RwaDemo, type RwaUnit } from '@/lib/rwa/demo'
import { usd, type RwaUnitLive } from './useRwaUnit'

// Mineral type for the RWA screens: a periwinkle eyebrow over a semibold Geist headline.
export const EY = 'text-[12.5px] uppercase tracking-[0.08em] font-semibold text-peri-deep'
export const H2 = 'font-geist font-semibold text-ink tracking-[-0.035em] text-[clamp(1.6rem,2.8vw,2.3rem)] leading-[1.08]'

// RWA icons, drawn in the same disc/layer language as components/ui2/MineralIcons (24 grid, 1.7 stroke).
function Ico({ size = 20, children }: { size?: number; children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}
/** A parcel of land: a disc with furrows. */
export function IconParcel({ size }: { size?: number }) {
  return <Ico size={size}><ellipse cx="12" cy="12" rx="9" ry="4.2" /><path d="M3 12v2.6c0 2.3 4 4.2 9 4.2s9-1.9 9-4.2V12" /><path d="M7 11.2c2.4-.9 5-.9 7.6 0M9 13.3c2-.6 4-.6 6 0" /></Ico>
}
/** A band with a needle — the appraisal band. */
export function IconBand({ size }: { size?: number }) {
  return <Ico size={size}><rect x="3" y="8" width="18" height="8" rx="4" /><path d="M9 8v8M15 8v8" strokeOpacity=".5" /><path d="M12.5 5.5v13" /></Ico>
}
/** A disc refusing — a transaction the chain reverted. */
export function IconRefused({ size }: { size?: number }) {
  return <Ico size={size}><ellipse cx="12" cy="9" rx="8.5" ry="3.4" /><path d="M3.5 9v5c0 1.9 3.8 3.4 8.5 3.4s8.5-1.5 8.5-3.4V9" /><path d="m10 7.6 4 2.8M14 7.6l-4 2.8" /></Ico>
}
/** A chain of two links — every step on-chain. */
export function IconChainLink({ size }: { size?: number }) {
  return <Ico size={size}><rect x="2.5" y="8.5" width="10" height="7" rx="3.5" /><rect x="11.5" y="8.5" width="10" height="7" rx="3.5" /></Ico>
}
/** A disc with a check — verified source. */
export function IconVerified({ size }: { size?: number }) {
  return <Ico size={size}><ellipse cx="12" cy="8" rx="8.5" ry="3.4" /><path d="M3.5 8v6c0 1.9 3.8 3.4 8.5 3.4s8.5-1.5 8.5-3.4V8" /><path d="m9.2 8.1 1.9 1.3 3.8-2.6" /></Ico>
}
/** Two crossing arrows — trades. */
export function IconTrades({ size }: { size?: number }) {
  return <Ico size={size}><path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3" /></Ico>
}

/** An icon on a recessed periwinkle tile (the Mineral feature-icon treatment). */
export function IconTile({ children, tone = 'peri' }: { children: ReactNode; tone?: 'peri' | 'coral' }) {
  return <span className="flex-none w-10 h-10 rounded-[12px] grid place-items-center" style={tone === 'coral' ? { color: '#9A3F1C', background: '#FBEEE7', boxShadow: 'inset 0 1px 2px rgba(154,63,28,.12)' } : { color: 'var(--mw-peri-deep)', background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}>{children}</span>
}

/** Segmented chain switch: an inset well with a raised pill on the active chain. */
export function ChainTabs({ units, active, href }: { units: RwaUnit[]; active: string; href: (slug: string) => string }) {
  if (units.length < 2) return null
  return (
    <div className="inline-flex rounded-[14px] p-1" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} role="tablist" aria-label="Chain">
      {units.map((x) => {
        const on = x.slug === active
        return (
          <Link key={x.slug} href={href(x.slug)} role="tab" aria-selected={on}
            className="rounded-[10px] px-3.5 py-1.5 text-[13px] font-semibold no-underline transition-colors"
            style={on ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { color: 'var(--mw-ink-2)' }}>
            {x.chain.name}
          </Link>
        )
      })}
    </div>
  )
}

export function LiveDot({ block, failed, label = 'Live' }: { block?: number; failed?: boolean; label?: string }) {
  if (failed) return <span className="text-[12px] text-ink-soft">Live read unavailable — {block ? `cached block ${block.toLocaleString()}` : 'showing the recorded run'}</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-mid">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mw-live opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-mw-live" /></span>
      {block ? <>{label} · block <span className="font-geist-mono">{block.toLocaleString()}</span></> : 'Connecting…'}
    </span>
  )
}

/**
 * The appraisal band as a single instrument: the hard band (anything ending outside is refused by the hook),
 * the core band (lowest fee), the appraisal, and a needle at the live pool price. Ticks are log-price, so the
 * gauge is drawn in tick space and labelled in dollars.
 */
export function BandGauge({ unit, demo, size = 'lg' }: { unit: RwaUnitLive; demo: RwaDemo; size?: 'lg' | 'sm' }) {
  const cfg = demo.hookConfig
  if (!cfg || !unit.band) return null
  const a = unit.appraisal.tick
  const spec = cfg.specBandTicks, core = cfg.coreBandTicks
  const pad = Math.round(spec * 0.45)
  const lo = a - spec - pad, hi = a + spec + pad
  const pct = (t: number) => `${((t - lo) / (hi - lo)) * 100}%`
  // bandStatus() returns |spot − appraisal| in ticks (unsigned); the side comes from the dollar prices, so the
  // gauge always reads left = cheaper than the appraisal, right = dearer, whatever the pool's currency order.
  const side = unit.spot.usd >= unit.appraisal.usd ? 1 : -1
  const spotT = Math.max(lo, Math.min(hi, a + side * unit.spot.deviationTicks))
  const outside = !unit.spot.inSpec
  const tall = size === 'lg'

  return (
    <div className="select-none">
      <div className={`relative ${tall ? 'h-[64px]' : 'h-[40px]'} rounded-[16px] overflow-hidden bg-[repeating-linear-gradient(135deg,rgba(201,87,43,0.16)_0_1px,transparent_1px_6px)]`} style={{ backgroundColor: '#FBF3EE', boxShadow: 'var(--mw-inset)' }}>
        <div className="absolute inset-y-0 bg-[#EDEBFC]" style={{ left: pct(a - spec), right: `calc(100% - ${pct(a + spec)})` }} />
        <div className="absolute inset-y-0 bg-[#D9D6FA]" style={{ left: pct(a - core), right: `calc(100% - ${pct(a + core)})` }} />
        <div className="absolute inset-y-0 w-[2px] -ml-px bg-peri-deep" style={{ left: pct(a) }} />
        <div
          className="absolute inset-y-0 transition-[left] duration-[1200ms] ease-out"
          style={{ left: pct(spotT) }}
          aria-label={`Pool price ${usd(unit.spot.usd, 2)}`}
        >
          <div className={`absolute inset-y-[-2px] w-[3px] -ml-[1.5px] rounded-full ${outside ? 'bg-coral2-deep' : 'bg-[#0F7A43]'}`} />
          <div className={`absolute ${tall ? 'top-1.5' : 'top-1'} -translate-x-1/2 rounded-full px-2 py-0.5 font-geist-mono text-[11px] font-medium text-white whitespace-nowrap shadow-sm ${outside ? 'bg-coral2-deep' : 'bg-[#0F7A43]'}`}>
            {usd(unit.spot.usd, 2)}
          </div>
        </div>
      </div>
      <div className="relative mt-2 h-[30px] text-[11px] text-ink-soft">
        <span className="absolute -translate-x-1/2 text-center leading-tight" style={{ left: pct(a - spec) }}>{usd(unit.band.spec[0], 2)}<br /><span className="text-[10px]">hard floor</span></span>
        <span className="absolute -translate-x-1/2 text-center leading-tight font-semibold text-peri-deep" style={{ left: pct(a) }}>{usd(unit.appraisal.usd, 2)}<br /><span className="text-[10px] font-normal">appraisal</span></span>
        <span className="absolute -translate-x-1/2 text-center leading-tight" style={{ left: pct(a + spec) }}>{usd(unit.band.spec[1], 2)}<br /><span className="text-[10px]">hard ceiling</span></span>
      </div>
      {tall && (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-ink-mid">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-[#D9D6FA]" />Core band · {unit.band.coreFeePct}% fee</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-[#EDEBFC]" style={{ boxShadow: 'inset 0 0 0 1px rgba(91,91,230,.15)' }} />Hard band · {unit.band.specFeePct}% fee</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-[#FBF3EE] bg-[repeating-linear-gradient(135deg,rgba(201,87,43,0.35)_0_1px,transparent_1px_4px)]" />Refused by the hook</span>
        </div>
      )}
    </div>
  )
}

/** Where every dollar of liquidity sits right now: earning in lending, in the pool, and the issuer's first-loss inventory. */
export function LiquidityMap({ unit, interest, symbol }: { unit: RwaUnitLive; interest: number | null; symbol: string }) {
  const lend = unit.lending.balanceUsd, pool = unit.vault.deployedUsd, junior = unit.vault.juniorUsd
  const total = Math.max(1, lend + pool + junior)
  const segs = [
    { k: 'lend', label: 'Earning in lending', v: lend, cls: 'bg-[#A9A7FA]', note: `${unit.lending.aprPct}% ${unit.lending.simulated ? 'simulated ' : ''}rate` },
    { k: 'pool', label: 'In the pool', v: pool, cls: 'bg-[#5B5BE6]', note: 'liquidity traders hit' },
    { k: 'junior', label: 'Issuer first-loss buffer', v: junior, cls: 'bg-[#F4A183]', note: `USD, plus ${Math.round(unit.vault.juniorUnits).toLocaleString()} ${symbol} locked beneath` },
  ]
  return (
    <div>
      <div className="flex h-[18px] w-full overflow-hidden rounded-full mw-inset p-[3px] gap-[3px]">
        {segs.map((s) => (
          <div key={s.k} className={`${s.cls} h-full transition-[width] duration-1000 ease-out rounded-full`} style={{ width: `${(s.v / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-5 divide-y divide-hair-soft">
        {segs.map((s) => (
          <div key={s.k} className="flex items-center justify-between gap-4 py-3 first:pt-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.cls}`} />{s.label}</div>
              <div className="mt-0.5 pl-[18px] text-[11.5px] text-ink-soft">{s.note}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-geist-mono text-[19px] tracking-[-0.02em]">{usd(s.v)}</div>
              <div className="text-[11.5px] text-ink-soft">{Math.round((s.v / total) * 100)}%</div>
            </div>
          </div>
        ))}
      </div>
      {interest !== null && (
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 rounded-[14px] px-4 py-3" style={{ background: 'var(--mw-band)' }}>
          <span className="text-[12.5px] text-ink-mid">Interest earned by idle liquidity, {unit.source === 'live' ? 'live estimate' : 'at snapshot'}{unit.lending.simulated ? ' (simulated rate)' : ''}</span>
          <span className="font-geist-mono text-[19px] text-peri-deep">{usd(interest, 4)}</span>
        </div>
      )}
    </div>
  )
}

/** The two proof transactions the chain refused — the headline evidence that compliance + the band are enforced on-chain. */
export function RefusalCards({ unit, compact = false }: { unit: RwaUnit; compact?: boolean }) {
  const ex = explorer(unit)
  const refused = unit.demo.legs.flatMap((l) => l.txs.map((t) => ({ ...t, leg: l }))).filter((t) => t.status === 'reverted')
  return (
    <div className={`grid gap-4 ${compact ? 'grid-cols-1' : 'grid-cols-2 max-[760px]:grid-cols-1'}`}>
      {refused.map((t) => (
        <div key={t.hash} className="mw-raise rounded-[22px] p-6 flex flex-col" style={{ outline: '1.5px solid rgba(201,87,43,.28)', outlineOffset: -1.5 }}>
          <div className="flex items-center gap-3">
            <IconTile tone="coral"><IconRefused /></IconTile>
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#9A3F1C]">Refused on-chain{t.reason ? ` · ${t.reason.error}` : ''}</span>
          </div>
          <h3 className="mt-4 text-[19px] font-semibold tracking-[-0.02em] leading-snug">{t.leg.title}</h3>
          <p className="mt-1.5 mb-0 text-[14px] leading-[1.55] text-ink-mid">{revertReasonText(t) ?? t.label}</p>
          <a href={ex.tx(t.hash)} target="_blank" rel="noreferrer" className="mt-5 self-start inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-geist-mono text-[12px] text-peri-deep no-underline hover:underline" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
            {shortHash(t.hash)} · mined, reverted ↗
          </a>
        </div>
      ))}
    </div>
  )
}

/** Spot price (from on-chain swaps) against the appraisal and its core / hard bands, on an event-sequence axis. */
export function PriceBandChart({ unit, demo }: { unit: RwaUnitLive; demo: RwaDemo }) {
  const W = 1000, H = 300, PL = 64, PR = 20, PT = 16, PB = 34
  const cfg = demo.hookConfig
  if (!cfg || (unit.priceSeries.length === 0 && unit.appraisalSeries.length === 0)) {
    return <div className="grid h-[260px] place-items-center text-[13px] text-ink-soft">No activity yet.</div>
  }
  const factor = (t: number) => Math.pow(1.0001, t)
  const coreF = factor(cfg.coreBandTicks), specF = factor(cfg.specBandTicks)

  type Ev = { kind: 'appraisal' | 'swap'; block: number; usd: number; byVault?: boolean }
  const events: Ev[] = [
    ...unit.appraisalSeries.map((a) => ({ kind: 'appraisal' as const, block: a.block, usd: a.usd })),
    ...unit.priceSeries.map((p) => ({ kind: 'swap' as const, block: p.block, usd: p.usd, byVault: p.byVault })),
  ].sort((a, b) => a.block - b.block || (a.kind === 'appraisal' ? -1 : 1))

  let appraisal = events.find((e) => e.kind === 'appraisal')?.usd ?? unit.appraisal.usd
  let spot = appraisal
  const slots: { appraisal: number; spot: number; ev: Ev | null }[] = [{ appraisal, spot, ev: null }]
  for (const e of events) {
    if (e.kind === 'appraisal') { appraisal = e.usd; if (slots.length === 1) { slots[0].appraisal = appraisal; slots[0].spot = appraisal; spot = appraisal; continue } }
    else spot = e.usd
    slots.push({ appraisal, spot, ev: e })
  }
  slots.push({ appraisal: unit.appraisal.usd, spot: unit.spot.usd, ev: null })

  const n = slots.length
  const X = (i: number) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR)
  const allY = slots.flatMap((s) => [s.spot, s.appraisal * specF, s.appraisal / specF])
  const y0 = Math.min(...allY) * 0.99, y1 = Math.max(...allY) * 1.01
  const Y = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB)
  const ticks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4)
  const half = (W - PL - PR) / Math.max(1, n - 1) / 2
  const line = slots.map((s, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(s.spot).toFixed(1)}`).join(' ')
  const area = `${line} L${X(n - 1).toFixed(1)} ${H - PB} L${X(0).toFixed(1)} ${H - PB} Z`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${demo.property.symbol} spot price against its appraisal band`}>
        <defs>
          <linearGradient id="rwaSpotFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5B5BE6" stopOpacity="0.16" /><stop offset="100%" stopColor="#5B5BE6" stopOpacity="0" /></linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} stroke="rgba(23,23,31,0.06)" />
            <text x={PL - 10} y={Y(v) + 4} textAnchor="end" fontSize="11" fontFamily="var(--font-geist-mono)" fill="#62626F">${v.toFixed(2)}</text>
          </g>
        ))}
        {slots.map((s, i) => {
          const xa = Math.max(PL, X(i) - half), xb = Math.min(W - PR, X(i) + half)
          return (
            <g key={`band${i}`}>
              <rect x={xa} width={xb - xa} y={Y(s.appraisal * specF)} height={Y(s.appraisal / specF) - Y(s.appraisal * specF)} fill="#EDEBFC" />
              <rect x={xa} width={xb - xa} y={Y(s.appraisal * coreF)} height={Y(s.appraisal / coreF) - Y(s.appraisal * coreF)} fill="#D9D6FA" />
              <line x1={xa} x2={xb} y1={Y(s.appraisal)} y2={Y(s.appraisal)} stroke="#4643D1" strokeDasharray="5 4" strokeWidth="1.25" />
            </g>
          )
        })}
        <path d={area} fill="url(#rwaSpotFill)" />
        <path d={line} fill="none" stroke="#2E2BA8" strokeWidth="2" strokeLinejoin="round" />
        {slots.map((s, i) => {
          if (!s.ev) return <circle key={`p${i}`} cx={X(i)} cy={Y(s.spot)} r={i === n - 1 ? 5 : 3} fill={i === n - 1 ? '#2E2BA8' : '#fff'} stroke="#2E2BA8" strokeWidth="1.5" />
          if (s.ev.kind === 'appraisal') return <rect key={`p${i}`} x={X(i) - 4} y={Y(s.appraisal) - 4} width="8" height="8" transform={`rotate(45 ${X(i)} ${Y(s.appraisal)})`} fill="#4643D1" />
          return <circle key={`p${i}`} cx={X(i)} cy={Y(s.spot)} r="3.4" fill={s.ev.byVault ? '#F4A183' : '#fff'} stroke={s.ev.byVault ? '#E88A67' : '#2E2BA8'} strokeWidth="1.5" />
        })}
        <text x={X(n - 1) - 8} y={Y(unit.spot.usd) + (unit.spot.usd < unit.appraisal.usd ? 18 : -10)} textAnchor="end" fontSize="12" fontWeight="600" fill="#2E2BA8">{unit.source === 'live' ? 'now' : 'snapshot'} ${unit.spot.usd.toFixed(2)}</text>
        <text x={X(n - 1) - 8} y={Y(unit.appraisal.usd) - 8} textAnchor="end" fontSize="11.5" fontWeight="600" fill="#4643D1">appraisal ${unit.appraisal.usd.toFixed(2)}</text>
        <text x={PL} y={H - 10} fontSize="11" fill="#62626F">pool opened at the appraisal</text>
        <text x={W - PR} y={H - 10} textAnchor="end" fontSize="11" fill="#62626F">{unit.source === 'live' ? 'now' : 'snapshot'} · block {unit.block.toLocaleString()}</text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 px-1 text-[12px] text-ink-mid">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[#2E2BA8] bg-white" />trade</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[#E88A67] bg-[#F4A183]" />vault unwind (an LP exit)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 bg-peri-deep" />new appraisal</span>
      </div>
    </div>
  )
}

export function Disclosure({ chainName, symbol }: { chainName: string; symbol: string }) {
  return (
    <p className="m-0 max-w-[90ch] rounded-[16px] px-5 py-4 text-[12.5px] leading-[1.6] text-ink-soft" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
      Testnet demonstration on {chainName}. The property is fictional; dUSD and {symbol} are valueless test tokens; the lending
      yield is simulated. The contracts are unaudited. A liquidity position is not a deposit, a savings product, or a guaranteed
      or fixed return. Nothing here is an offer of securities or of any investment.{' '}
      <a href="/legal" className="font-semibold text-peri-deep no-underline hover:underline">Legal →</a>
    </p>
  )
}

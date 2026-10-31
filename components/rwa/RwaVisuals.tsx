'use client'

// Mineral building blocks for the owned-engine screens and archived proof. Light-only.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { formatUnits } from 'viem'
import { RWA_QUOTE_ASSET } from '@/lib/rwa/units'
import { type RwaUnitLive } from './useRwaUnit'

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
export function ChainTabs({ units, active, href }: { units: { slug: string; chain: { name: string } }[]; active: string; href: (slug: string) => string }) {
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

export function LiveDot({ block, failed, label = 'Live' }: { block?: number | null; failed?: boolean; label?: string }) {
  if (failed) return <span className="text-[12px] text-ink-soft">Live read unavailable — {block ? `cached block ${block.toLocaleString()}` : 'no current snapshot'}</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-mid">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mw-live opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-mw-live" /></span>
      {block ? <>{label} · block <span className="font-geist-mono">{block.toLocaleString()}</span></> : 'Connecting…'}
    </span>
  )
}

export const amount = (value: string | null | undefined, decimals: number) => value == null ? '—' : formatUnits(BigInt(value), decimals)
export const observedDate = (timestamp: number) => new Date(timestamp * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC')

export function ReadState({ unit, failed }: { unit: RwaUnitLive | null; failed: boolean }) {
  if (unit?.source === 'undeployed') return <p className="text-[14px] text-ink-mid">The owned engine has not been deployed yet. Holdings, appraisals and permissions will appear after installation.</p>
  if (!unit) return <p className="text-[14px] text-ink-soft">{failed ? 'Current engine data is unavailable. Retrying the chain read…' : 'Reading the owned engine…'}</p>
  return null
}

/** Pool ticks avoid inferring a token ordering or price from the retired deployment. */
export function BandGauge({ unit }: { unit: RwaUnitLive }) {
  const h = unit.hook
  if (!h) return <p className="text-[13px] text-ink-soft">Appraisal band unavailable.</p>
  const extent = Math.max(1, h.specBandTicks * 1.25, Math.abs(h.spotTick - h.appraisalTick) * 1.1)
  const x = (tick: number) => 50 + (tick - h.appraisalTick) / extent * 50
  return <div>
    <div role="img" aria-label={`Spot tick ${h.spotTick}; appraisal tick ${h.appraisalTick}; core band plus or minus ${h.coreBandTicks}, outer band plus or minus ${h.specBandTicks} ticks${unit.source === 'cached' ? ', cached snapshot' : ''}`}>
      <div className="flex justify-between gap-3 text-[12px] text-ink-soft"><span>Outer band</span><span>Core band</span><span>Outer band</span></div>
      <div className="relative mt-3 h-10 rounded-full" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
        <span className="absolute inset-y-0 rounded-full bg-[#EDE9FB]" style={{ left: `${x(h.appraisalTick - h.specBandTicks)}%`, width: `${h.specBandTicks / extent * 100}%` }} />
        <span className="absolute inset-y-0 rounded-full bg-[#C9C0F4]" style={{ left: `${x(h.appraisalTick - h.coreBandTicks)}%`, width: `${h.coreBandTicks / extent * 100}%` }} />
        <span className="absolute -top-2 h-14 border-l border-dashed border-peri-deep" style={{ left: '50%' }} />
        <span className="absolute -top-1 h-12 w-1 rounded-full bg-ink" style={{ left: `${x(h.spotTick)}%` }} />
      </div>
    </div>
    <dl className="mt-5 grid grid-cols-2 gap-3 text-[12.5px] text-ink-mid">
      <div><dt>Spot tick{unit.source === 'cached' ? ' at snapshot' : ''}</dt><dd className="font-geist-mono text-ink">{h.spotTick}</dd></div>
      <div><dt>Appraisal tick</dt><dd className="font-geist-mono text-peri-deep">{h.appraisalTick}</dd></div>
      <div><dt>Core · ±{h.coreBandTicks} ticks</dt><dd>{h.coreFeePips / 10000}% fee</dd></div>
      <div><dt>Outer · ±{h.specBandTicks} ticks</dt><dd>{h.specFeePips / 10000}% fee</dd></div>
    </dl>
  </div>
}

export function LiquidityMap({ unit, symbol = 'Property' }: { unit: RwaUnitLive; symbol?: string }) {
  const engine = unit.engine
  if (!engine) return <p className="text-[13px] text-ink-soft">Holdings will appear after installation.</p>
  return <div>
    <dl className="grid grid-cols-2 gap-4 border-b border-hair-soft pb-5">
      <div><dt className="text-[12px] text-ink-soft">NAV (USDC){unit.source === 'cached' ? ' at snapshot' : ''}</dt><dd className="mt-1 font-geist-mono text-[20px] break-words">{amount(engine.nav, 6)}</dd>{engine.nav === null && <p className="text-[12px] text-ink-soft">Unavailable — appraisal may be stale</p>}</div>
      <div><dt className="text-[12px] text-ink-soft">Share supply</dt><dd className="mt-1 font-geist-mono text-[20px] break-words">{amount(engine.supply, 18)}</dd><p className="text-[12px] text-ink-soft">One non-transferable share class</p></div>
    </dl>
    <div className="mt-5 grid gap-3">
      {engine.balances.map((b) => <div key={b.token} className="rounded-[14px] p-4" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
        <div className="text-[13px] font-semibold" title={b.token}>{b.token.toLowerCase() === RWA_QUOTE_ASSET ? 'USDC' : symbol}</div>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-[12px] text-ink-soft">
          <div><dt>Held by engine</dt><dd className="mt-1 font-geist-mono text-ink break-words">{amount(b.engine, b.decimals)}</dd></div>
          <div><dt>Idle adapter</dt><dd className="mt-1 font-geist-mono text-ink break-words">{amount(b.idle, b.decimals)}</dd></div>
        </dl>
      </div>)}
    </div>
    <div className="mt-4 text-[12.5px] text-ink-mid">Direct pool position · <span className="font-geist-mono break-all">{engine.position.liquidity}</span> liquidity<br />Ticks {engine.position.tickLower} to {engine.position.tickUpper}</div>
    {engine.shares !== null && <p className="mt-3 text-[13px] text-ink-mid">Your shares · <span className="font-geist-mono">{amount(engine.shares, 18)}</span></p>}
  </div>
}
export function Disclosure({ chainName, symbol }: { chainName: string; symbol: string }) {
  return <p className="mt-6 text-[13px] text-ink-soft">Testnet demonstration on {chainName}. {symbol} represents a fictional property. Test tokens have no monetary value. Contracts are unaudited.</p>
}

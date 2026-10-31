'use client'

// V2-RWAs visual building blocks — light-only. Every number comes from the live chain read (useRwaUnit) or
// the recorded proof run (lib/rwa/demo.ts); nothing here is decorative data.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { formatUnits } from 'viem'
import type { RwaUnit } from '@/config/rwa-archive/proof'
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
  if (failed) return <span className="text-[12px] text-ink-soft">Live read unavailable — {block ? `cached block ${block.toLocaleString()}` : 'no current snapshot'}</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-mid">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mw-live opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-mw-live" /></span>
      {block ? <>{label} · block <span className="font-geist-mono">{block.toLocaleString()}</span></> : 'Connecting…'}
    </span>
  )
}

export function LiquidityMap({ unit }: { unit: RwaUnitLive }) {
  if (!unit.engine) return null
  return <div className="mw-raise rounded-[22px] p-6">
    <h2 className={H2}>Engine holdings {unit.source === 'cached' ? 'at snapshot' : ''}</h2>
    <dl className="mt-4 grid gap-3">
      <div><dt>NAV (USDC)</dt><dd>{unit.engine.nav === null ? 'Unavailable — appraisal may be stale' : formatUnits(BigInt(unit.engine.nav), 6)}</dd></div>
      <div><dt>Share supply</dt><dd>{formatUnits(BigInt(unit.engine.supply), 18)}</dd></div>
      {unit.engine.balances.map((b, i) => <div key={b.token}><dt>Asset {i + 1} · {b.token}</dt><dd>{formatUnits(BigInt(b.engine), b.decimals)} in engine · {formatUnits(BigInt(b.idle), b.decimals)} idle</dd></div>)}
      <div><dt>Position</dt><dd>{unit.engine.position.liquidity} liquidity · ticks {unit.engine.position.tickLower} to {unit.engine.position.tickUpper}</dd></div>
      {unit.engine.shares !== null && <div><dt>Your shares</dt><dd>{formatUnits(BigInt(unit.engine.shares),18)}</dd></div>}
    </dl>
  </div>
}
export function Disclosure({ chainName, symbol }: { chainName: string; symbol: string }) {
  return <p className="mt-6 text-[13px] text-ink-soft">Testnet demonstration on {chainName}. {symbol} represents a fictional property. Test tokens have no monetary value. Contracts are unaudited.</p>
}

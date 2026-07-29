'use client'

// =============================================================================
// /style/swap — elevated swap concept (design lab). Self-contained, mock data.
// Editorial hero tells the two-surface reputation story; the swap card carries a
// DeFi ↔ RWA surface toggle; the attribution rail makes reputation legible at the
// moment of the trade. Promote to /swap once the feel is locked.
// =============================================================================

import { useMemo, useState } from 'react'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const LINE = 'border-atx-ink/20'
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 4 : 2 })

// ─── mock markets ────────────────────────────────────────────────────────────
type Surface = 'DeFi' | 'RWA'
const DEFI = {
  from: { sym: 'USDC', name: 'USD Coin', usd: 1 },
  to: { sym: 'ETH', name: 'Ether', usd: 3412 },
  routes: 12,
}
const BALANCE = 12_400 // mock USDC balance
type Deal = { sym: string; name: string; apy: number; band: string; settle: number; asset: string }
const DEALS: Deal[] = [
  { sym: 'vTBILL', name: 'Sovereign T-Bill', apy: 5.1, band: '±5 / ±15', settle: 7, asset: 'US Treasuries' },
  { sym: 'vTRADE', name: 'Meridian Trade Finance', apy: 11.8, band: '±15 / ±45', settle: 30, asset: 'Trade receivables' },
  { sym: 'vCARBON', name: 'Verdant Carbon Note', apy: 7.2, band: '±20 / ±60', settle: 45, asset: 'Carbon offsets' },
]

// reputation identity (mock — mirrors the landing concept)
const ME = { handle: 'vaultking.mintware', score: 247, tier: 'Builder', pct: 5, mult: 1.5, multTier: 'Gold' }

export default function StyleSwapConcept() {
  const [surface, setSurface] = useState<Surface>('DeFi')
  const [amount, setAmount] = useState('2500')
  const [dealIdx, setDealIdx] = useState(0)
  const isDeFi = surface === 'DeFi'
  const accent = isDeFi ? 'text-atx-blue' : 'text-atx-coral'
  const accentBg = isDeFi ? 'bg-atx-blue text-white border-atx-blue' : 'bg-atx-coral text-atx-ink border-atx-ink'
  const deal = DEALS[dealIdx]

  const amt = Number(amount) || 0
  const { fromSym, toSym, receive, sub } = useMemo(() => {
    if (isDeFi) {
      return { fromSym: DEFI.from.sym, toSym: DEFI.to.sym, receive: amt / DEFI.to.usd, sub: `Best of ${DEFI.routes} sources · $${DEFI.to.usd.toLocaleString()}/ETH` }
    }
    return { fromSym: 'USDC', toSym: deal.sym, receive: amt, sub: `${deal.name} · at NAV` }
  }, [isDeFi, amt, deal])

  // reputation-weighted reward preview (mock): base points × tier multiplier
  const basePts = Math.round(amt * (isDeFi ? 0.1 : 0.14))
  const boostedPts = Math.round(basePts * ME.mult)

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* Top bar */}
      <div className="flex items-center gap-3.5 px-7 h-[58px] border-b border-atx-ink/20 sticky top-0 bg-atx-bone z-10">
        <Star className="w-[18px] h-[18px] text-atx-blue" />
        <span className="font-bold">Swap</span>
        <button className="ml-auto font-atx-mono text-[12px] text-atx-ink/55 border border-atx-ink/20 px-2.5 py-1.5">Search ⌘K</button>
        <button className="font-semibold text-[13px] font-atx-mono px-3 py-1.5 border border-atx-blue bg-atx-blue text-white uppercase tracking-[0.04em]">Connect Wallet</button>
      </div>

      {/* Editorial hero */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="px-7 pt-8 pb-7">
          <p className={`${LABEL} mb-4`}>On-chain reputation · rewards · 100+ chains</p>
          <h1 className="font-bold tracking-[-0.03em] leading-[0.85] text-[clamp(44px,8vw,92px)]">
            TRADE LIKE IT <span className="text-atx-blue">COUNTS.</span>
          </h1>
          <p className="text-atx-ink/60 text-[15px] max-w-[64ch] mt-4">
            Every swap builds your Attribution score and earns rewards weighted by who you are —
            routed across DeFi pools and SPV-wrapped real-world assets. One surface for the trade,
            one for the record.
          </p>
        </div>
        {/* stat band */}
        <div className="border-t border-atx-ink grid [grid-template-columns:1.4fr_1fr_1fr_1fr] max-[720px]:[grid-template-columns:1fr_1fr]">
          {[
            ['Your score', <span key="s" className="text-atx-blue">{ME.score}</span>, `${ME.tier} · top ${ME.pct}%`],
            ['Reward multiplier', `${ME.mult.toFixed(1)}×`, `${ME.multTier} tier`],
            ['Surfaces', 'DeFi · RWA', 'one on-ramp'],
            ['Settlement', 'Live', 'oracle-banded'],
          ].map(([l, v, sub], i) => (
            <div key={i} className={`px-7 py-3 ${i < 3 ? 'border-r border-atx-ink/20' : ''}`}>
              <div className={`${LABEL} text-[9px] mb-1.5`}>{l}</div>
              <div className="font-bold text-[15px] tabular-nums">{v}</div>
              <div className="font-atx-mono text-[10px] text-atx-ink/45 mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Swap surface + attribution rail */}
      <div className="px-7 py-8 grid [grid-template-columns:1.35fr_1fr] gap-[22px] max-[900px]:grid-cols-1">
        {/* ── Swap card ── */}
        <div className="border border-atx-ink bg-atx-bone flex flex-col">
          {/* surface toggle */}
          <div className="flex items-stretch border-b border-atx-ink">
            {(['DeFi', 'RWA'] as Surface[]).map((s) => {
              const on = surface === s
              const onCls = s === 'DeFi' ? 'bg-atx-blue text-white' : 'bg-atx-coral text-atx-ink'
              return (
                <button
                  key={s}
                  onClick={() => setSurface(s)}
                  className={`flex-1 py-3.5 font-atx-mono text-[13px] uppercase tracking-[0.12em] border-r border-atx-ink last:border-r-0 flex items-center justify-center gap-2 ${on ? onCls : 'bg-transparent text-atx-ink/50'}`}
                >
                  {on && <Star className="w-3 h-3" />}
                  {s}
                  <span className="text-[10px] opacity-70">{s === 'DeFi' ? 'tokens' : 'real-world yield'}</span>
                </button>
              )
            })}
          </div>

          {/* From */}
          <div className="p-[16px_18px]">
            <div className={`${LABEL} mb-2`}>You pay</div>
            <div className="flex items-center gap-3">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                className="flex-1 bg-transparent font-atx-display font-bold text-[34px] tracking-tight outline-none min-w-0"
              />
              <div className="shrink-0 flex items-center gap-2 border border-atx-ink px-3 py-2 font-atx-mono text-[14px]">
                <span className="font-bold">{fromSym}</span>
                <span className="text-atx-ink/40 text-[11px]">▾</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1.5 font-atx-mono text-[11px] text-atx-ink/45">
              <span>≈ ${fmt(amt * (isDeFi ? DEFI.from.usd : 1))}</span>
              <span>
                Balance {BALANCE.toLocaleString()} USDC{' '}
                <button onClick={() => setAmount(String(BALANCE))} className="text-atx-blue uppercase tracking-[0.06em]">Max</button>
              </span>
            </div>
          </div>

          {/* direction */}
          <div className="relative border-t border-atx-ink/20">
            <div className="absolute -top-3.5 left-[18px] w-7 h-7 border border-atx-ink bg-atx-bone flex items-center justify-center text-atx-ink/60">↓</div>
          </div>

          {/* To */}
          <div className="p-[16px_18px]">
            <div className={`${LABEL} mb-2`}>You receive</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 font-atx-display font-bold text-[34px] tracking-tight tabular-nums min-w-0 truncate">
                {fmt(receive)}
              </div>
              {isDeFi ? (
                <div className="shrink-0 flex items-center gap-2 border border-atx-ink px-3 py-2 font-atx-mono text-[14px]">
                  <span className="font-bold">{toSym}</span>
                  <span className="text-atx-ink/40 text-[11px]">▾</span>
                </div>
              ) : (
                <button
                  onClick={() => setDealIdx((i) => (i + 1) % DEALS.length)}
                  className="shrink-0 flex items-center gap-2 border border-atx-ink bg-atx-coral text-atx-ink px-3 py-2 font-atx-mono text-[14px]"
                >
                  <span className="font-bold">{toSym}</span>
                  <span className="text-[11px]">▾</span>
                </button>
              )}
            </div>
            <div className="font-atx-mono text-[11px] text-atx-ink/45 mt-1.5">{sub}</div>
          </div>

          {/* route / band info */}
          {isDeFi ? (
            <div className={`p-[13px_18px] border-t ${LINE} grid grid-cols-3`}>
              {[['Route', '0x · Molten'], ['Aggregated', `${DEFI.routes} sources`], ['Fee', '0.50%']].map(([l, v], i) => (
                <div key={i} className={i < 2 ? `border-r ${LINE} pr-3` : ''}>
                  <div className={`${LABEL} text-[9px]`}>{l}</div>
                  <div className="font-atx-mono text-[14px] mt-0.5">{v}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className={`p-[13px_18px] border-t ${LINE} grid grid-cols-4`}>
              {[['Underlying', deal.asset], ['Target APY', `${deal.apy}%`], ['NAV band', deal.band], ['Settle', `${deal.settle}d`]].map(([l, v], i) => (
                <div key={i} className={i < 3 ? `border-r ${LINE} pr-2` : ''}>
                  <div className={`${LABEL} text-[9px]`}>{l}</div>
                  <div className={`font-atx-mono text-[13px] mt-0.5 ${i === 1 ? 'text-atx-coral' : ''}`}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className={`p-[14px_18px] border-t ${LINE} flex items-center gap-3`}>
            <span className="font-atx-mono text-[11px] text-atx-ink/50 flex items-center gap-1.5">
              <Star className={`w-3 h-3 ${accent}`} />
              {isDeFi ? 'Reputation-weighted rewards on every fill' : 'SPV-wrapped · KYC lives in the token, not here'}
            </span>
            <button className={`ml-auto font-semibold text-[15px] px-6 py-3 border uppercase tracking-[0.04em] ${accentBg}`}>
              {isDeFi ? 'Swap →' : 'Swap into yield →'}
            </button>
          </div>
        </div>

        {/* ── Attribution rail ── */}
        <aside className="flex flex-col gap-[22px]">
          {/* standing */}
          <div className="border border-atx-ink bg-atx-ink text-atx-bone">
            <div className="p-[16px_18px] flex items-start justify-between">
              <div>
                <div className="font-atx-mono text-[10px] uppercase tracking-[0.12em] text-atx-bone/45 mb-1">Your standing</div>
                <div className="font-bold text-[40px] leading-none tabular-nums">{ME.score}</div>
                <div className="font-atx-mono text-[11px] text-atx-bone/50 mt-1">{ME.handle}</div>
              </div>
              <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] px-2 py-1 border border-atx-bone/40">{ME.tier}</span>
            </div>
            <div className="grid grid-cols-2 border-t border-atx-bone/20">
              <div className="px-[18px] py-3 border-r border-atx-bone/20">
                <div className="font-atx-mono text-[9px] uppercase tracking-[0.12em] text-atx-bone/40 mb-1">Percentile</div>
                <div className="font-bold text-[15px]">top {ME.pct}%</div>
              </div>
              <div className="px-[18px] py-3">
                <div className="font-atx-mono text-[9px] uppercase tracking-[0.12em] text-atx-bone/40 mb-1">Reward tier</div>
                <div className="font-bold text-[15px] text-atx-acid">{ME.multTier} · {ME.mult}×</div>
              </div>
            </div>
          </div>

          {/* this swap */}
          <div className="border border-atx-ink bg-atx-bone">
            <div className={`px-[18px] py-3 border-b ${LINE} ${LABEL}`}>What this swap earns</div>
            <div className="p-[16px_18px] flex flex-col gap-2.5">
              <Row l="Base points" v={`${basePts.toLocaleString()}`} />
              <Row l={`${ME.multTier} multiplier`} v={`× ${ME.mult}`} accent={accent} />
              <div className={`border-t ${LINE} pt-2.5 flex items-center justify-between`}>
                <span className="font-bold text-[14px]">You earn</span>
                <span className={`font-bold text-[22px] tabular-nums ${accent}`}>{boostedPts.toLocaleString()} pts</span>
              </div>
              <div className="font-atx-mono text-[10px] text-atx-ink/45">
                + builds Volume &amp; Trading signals on your Attribution score
              </div>
            </div>
          </div>

          {/* campaigns fed */}
          <div className="border border-atx-ink bg-atx-bone">
            <div className={`px-[18px] py-3 border-b ${LINE} ${LABEL}`}>Feeds 2 live campaigns</div>
            {[
              { s: 'DeFi', n: 'Base Volume Sprint', d: '8 pts / trade · ends T−4d', a: 'text-atx-blue' },
              { s: 'RWA', n: 'Sovereign T-Bill · Hold', d: 'oracle-banded · duration-matched', a: 'text-atx-coral' },
            ].map((c) => (
              <div key={c.n} className={`p-[13px_18px] border-b ${LINE} last:border-b-0 flex items-center gap-3`}>
                <Star className={`w-4 h-4 ${c.a}`} />
                <div className="min-w-0">
                  <div className="font-bold text-[14px] truncate">{c.n}</div>
                  <div className="font-atx-mono text-[11px] text-atx-ink/50">{c.s} · {c.d}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-ink/40 flex items-center gap-1.5 px-1">
            <Star className="w-3 h-3" /> Powered by Attribution
          </div>
        </aside>
      </div>
    </div>
  )
}

function Row({ l, v, accent }: { l: string; v: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-atx-mono text-[12px] text-atx-ink/60">{l}</span>
      <span className={`font-atx-mono text-[14px] tabular-nums ${accent ?? ''}`}>{v}</span>
    </div>
  )
}

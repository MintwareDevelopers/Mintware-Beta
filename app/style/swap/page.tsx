'use client'

// =============================================================================
// /style/swap — elevated swap concept (design lab). Self-contained, mock data.
// Editorial hero tells the two-surface reputation story; a "suggested · where the
// points are" strip loads a campaign-backed swap straight into the widget on click;
// the swap card carries a DeFi ↔ RWA surface toggle; the attribution rail makes
// reputation legible at the moment of the trade. Promote to /swap when the feel's locked.
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

// ─── mock markets (each carries the campaign it earns into) ───────────────────
type Surface = 'DeFi' | 'RWA'
const BALANCE = 12_400 // mock USDC balance
const ROUTES = 12

type DefiTok = { sym: string; name: string; usd: number; campaign: string; reward: string }
const DEFI_TOKENS: DefiTok[] = [
  { sym: 'ETH',   name: 'Ether',        usd: 3412,   campaign: 'Base Volume Sprint', reward: '8 pts / trade' },
  { sym: 'cbBTC', name: 'Coinbase BTC', usd: 68_000, campaign: 'BTC Builder',        reward: '12 pts / trade' },
  { sym: 'DEGEN', name: 'Degen',        usd: 0.0123, campaign: 'Degen Days',         reward: '15 pts / trade' },
]

type Deal = { sym: string; name: string; apy: number; band: string; settle: number; asset: string; campaign: string; reward: string }
const DEALS: Deal[] = [
  { sym: 'vTBILL',  name: 'Sovereign T-Bill',       apy: 5.1,  band: '±5 / ±15',  settle: 7,  asset: 'US Treasuries',     campaign: 'T-Bill · Hold',       reward: 'hold pts · 5.1% base' },
  { sym: 'vTRADE',  name: 'Meridian Trade Finance', apy: 11.8, band: '±15 / ±45', settle: 30, asset: 'Trade receivables', campaign: 'Trade Finance · Hold', reward: 'hold pts · 11.8% base' },
  { sym: 'vCARBON', name: 'Verdant Carbon Note',    apy: 7.2,  band: '±20 / ±60', settle: 45, asset: 'Carbon offsets',    campaign: 'Carbon · Hold',       reward: 'hold pts · 7.2% base' },
]

type Suggestion = { surface: Surface; idx: number; sym: string; campaign: string; reward: string }
const SUGGESTIONS: Suggestion[] = [
  ...DEFI_TOKENS.map((t, i) => ({ surface: 'DeFi' as const, idx: i, sym: t.sym, campaign: t.campaign, reward: t.reward })),
  ...DEALS.map((d, i) => ({ surface: 'RWA' as const, idx: i, sym: d.sym, campaign: d.campaign, reward: d.reward })),
]

const ME = { handle: 'vaultking.mintware', score: 247, tier: 'Builder', pct: 5, mult: 1.5, multTier: 'Gold' }

export default function StyleSwapConcept() {
  const [surface, setSurface] = useState<Surface>('DeFi')
  const [amount, setAmount] = useState('2500')
  const [defiToIdx, setDefiToIdx] = useState(0)
  const [dealIdx, setDealIdx] = useState(0)

  const isDeFi = surface === 'DeFi'
  const accent = isDeFi ? 'text-atx-blue' : 'text-atx-coral'
  const accentBg = isDeFi ? 'bg-atx-blue text-white border-atx-blue' : 'bg-atx-coral text-atx-ink border-atx-ink'
  const tok = DEFI_TOKENS[defiToIdx]
  const deal = DEALS[dealIdx]

  const amt = Number(amount) || 0
  const { toSym, receive, sub } = useMemo(() => {
    if (isDeFi) return { toSym: tok.sym, receive: amt / tok.usd, sub: `Best of ${ROUTES} sources · $${tok.usd.toLocaleString()}/${tok.sym}` }
    return { toSym: deal.sym, receive: amt, sub: `${deal.name} · at NAV` }
  }, [isDeFi, amt, tok, deal])

  const basePts = Math.round(amt * (isDeFi ? 0.1 : 0.14))
  const boostedPts = Math.round(basePts * ME.mult)

  function load(s: Suggestion) {
    setSurface(s.surface)
    if (s.surface === 'DeFi') setDefiToIdx(s.idx)
    else setDealIdx(s.idx)
  }
  const isLoaded = (s: Suggestion) =>
    s.surface === surface && s.idx === (s.surface === 'DeFi' ? defiToIdx : dealIdx)

  // rail: campaigns this swap feeds — primary reflects the current selection
  const feeds = isDeFi
    ? [{ s: 'DeFi', n: tok.campaign, d: `${tok.reward} · live`, a: 'text-atx-blue' },
       { s: 'RWA',  n: 'Sovereign T-Bill · Hold', d: 'oracle-banded · duration-matched', a: 'text-atx-coral' }]
    : [{ s: 'RWA',  n: deal.campaign, d: deal.reward, a: 'text-atx-coral' },
       { s: 'DeFi', n: 'Base Volume Sprint', d: '8 pts / trade · ends T−4d', a: 'text-atx-blue' }]

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

      {/* Suggested swaps — click loads it into the widget */}
      <div className="px-7 pt-7">
        <div className="flex items-baseline gap-3 mb-3">
          <span className={LABEL}>Suggested · where the points are</span>
          <span className="font-atx-mono text-[11px] text-atx-ink/40">tap to load ↓</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1.5 [scrollbar-width:thin]">
          {SUGGESTIONS.map((s) => {
            const on = isLoaded(s)
            const a = s.surface === 'DeFi' ? 'text-atx-blue' : 'text-atx-coral'
            const chip = s.surface === 'DeFi' ? 'border-atx-blue text-atx-blue' : 'border-atx-coral text-atx-coral'
            return (
              <button
                key={`${s.surface}-${s.idx}`}
                onClick={() => load(s)}
                className={`shrink-0 w-[218px] text-left border p-[13px_15px] transition-colors ${on ? 'border-atx-ink bg-atx-ink text-atx-bone' : 'border-atx-ink/25 bg-atx-bone hover:border-atx-ink'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Star className={`w-3.5 h-3.5 ${on ? '' : a}`} />
                  <span className={`font-atx-mono text-[10px] uppercase tracking-[0.1em] ${on ? 'text-atx-bone/60' : 'text-atx-ink/50'}`}>{s.surface}</span>
                  {on && <span className="ml-auto font-atx-mono text-[9px] uppercase tracking-[0.1em] text-atx-acid">loaded</span>}
                </div>
                <div className="font-bold text-[15px] tracking-tight">USDC → {s.sym}</div>
                <div className={`font-atx-mono text-[11px] mt-0.5 ${on ? 'text-atx-bone/55' : 'text-atx-ink/55'}`}>{s.campaign}</div>
                <span className={`inline-block mt-2.5 font-atx-mono text-[10px] uppercase tracking-[0.05em] px-2 py-1 border ${on ? 'border-atx-bone/40 text-atx-bone' : chip}`}>{s.reward}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Swap surface + attribution rail */}
      <div className="px-7 py-7 grid [grid-template-columns:1.35fr_1fr] gap-[22px] max-[900px]:grid-cols-1">
        {/* ── Swap card ── */}
        <div className="border border-atx-ink bg-atx-bone flex flex-col">
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
                <span className="font-bold">USDC</span>
                <span className="text-atx-ink/40 text-[11px]">▾</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1.5 font-atx-mono text-[11px] text-atx-ink/45">
              <span>≈ ${fmt(amt)}</span>
              <span>Balance {BALANCE.toLocaleString()} USDC{' '}
                <button onClick={() => setAmount(String(BALANCE))} className="text-atx-blue uppercase tracking-[0.06em]">Max</button>
              </span>
            </div>
          </div>

          <div className="relative border-t border-atx-ink/20">
            <div className="absolute -top-3.5 left-[18px] w-7 h-7 border border-atx-ink bg-atx-bone flex items-center justify-center text-atx-ink/60">↓</div>
          </div>

          <div className="p-[16px_18px]">
            <div className={`${LABEL} mb-2`}>You receive</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 font-atx-display font-bold text-[34px] tracking-tight tabular-nums min-w-0 truncate">{fmt(receive)}</div>
              <button
                onClick={() => (isDeFi ? setDefiToIdx((i) => (i + 1) % DEFI_TOKENS.length) : setDealIdx((i) => (i + 1) % DEALS.length))}
                className={`shrink-0 flex items-center gap-2 border px-3 py-2 font-atx-mono text-[14px] ${isDeFi ? 'border-atx-ink bg-atx-bone' : 'border-atx-ink bg-atx-coral text-atx-ink'}`}
              >
                <span className="font-bold">{toSym}</span>
                <span className="text-[11px] opacity-60">▾</span>
              </button>
            </div>
            <div className="font-atx-mono text-[11px] text-atx-ink/45 mt-1.5">{sub}</div>
          </div>

          {isDeFi ? (
            <div className={`p-[13px_18px] border-t ${LINE} grid grid-cols-3`}>
              {[['Route', '0x · Molten'], ['Aggregated', `${ROUTES} sources`], ['Fee', '0.50%']].map(([l, v], i) => (
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

          <div className="border border-atx-ink bg-atx-bone">
            <div className={`px-[18px] py-3 border-b ${LINE} ${LABEL}`}>What this swap earns</div>
            <div className="p-[16px_18px] flex flex-col gap-2.5">
              <Row l="Base points" v={`${basePts.toLocaleString()}`} />
              <Row l={`${ME.multTier} multiplier`} v={`× ${ME.mult}`} accent={accent} />
              <div className={`border-t ${LINE} pt-2.5 flex items-center justify-between`}>
                <span className="font-bold text-[14px]">You earn</span>
                <span className={`font-bold text-[22px] tabular-nums ${accent}`}>{boostedPts.toLocaleString()} pts</span>
              </div>
              <div className="font-atx-mono text-[10px] text-atx-ink/45">+ builds Volume &amp; Trading signals on your Attribution score</div>
            </div>
          </div>

          <div className="border border-atx-ink bg-atx-bone">
            <div className={`px-[18px] py-3 border-b ${LINE} ${LABEL}`}>Feeds 2 live campaigns</div>
            {feeds.map((c) => (
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

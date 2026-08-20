'use client'

// /the-math — "The Math": a LIVE, benchmarked comparison of what capital actually earns.
// Every DeFi row is a real pool pulled from DefiLlama (see /api/benchmarks/yields) — real APY,
// real TVL, real volume, stamped with an as-of date and source. Nothing here is a made-up number.
// Mintware's own row is the ONE honest projection: it stacks the two real rows above it (lending
// floor + stable-LP fees on the same dollar — the ULV thesis), clearly labelled projected/testnet,
// because there is no live Mintware pool to measure yet. The fund row is an illustrative 2-and-20.
// Light-only, platform design system. Reputation/Attribution stays out of this surface on purpose.

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
  key: string; label: string; blurb: string; kind: 'floor' | 'fees' | 'volatile'
  chain: string; symbol: string; apyBase: number | null; apyMean30d: number | null
  apyReward: number | null; tvlUsd: number; volumeUsd1d: number | null
  stablecoin: boolean; ilRisk: string
}
type Feed = { ok: true; source: string; sourceUrl: string; asOf: string; rows: Row[] } | { ok: false }

// Fund assumptions — illustrative, industry-standard "2 and 20". Fixed + labelled, not live data.
const FUND = { gross: 12, mgmt: 2, perf: 20 }

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
  const floor = rows.filter(r => r.kind === 'floor')
  const fees = rows.filter(r => r.kind === 'fees')
  const volatile = rows.filter(r => r.kind === 'volatile')

  // Mintware's honest projection: deepest Base/USDC lending floor + the USDC/USDT stable-fee pool,
  // stacked on the same dollar (the ULV mechanism). Falls back to whatever floor/fee rows exist.
  const mwFloor = floor.find(r => r.chain === 'Base') ?? floor[0] ?? null
  const mwFee = fees.find(r => /USDC-USDT|USDT-USDC/.test(r.symbol)) ?? fees[0] ?? null
  const stackApy = useMemo(() => {
    if (!mwFloor || !mwFee) return null
    return (mwFloor.apyBase ?? 0) + (mwFee.apyBase ?? 0)
  }, [mwFloor, mwFee])
  // 30-day-average stack — the defensible baseline that doesn't ride a single-day fee spike.
  const stackApy30 = useMemo(() => {
    if (!mwFloor || !mwFee) return null
    if (mwFloor.apyMean30d == null || mwFee.apyMean30d == null) return null
    return mwFloor.apyMean30d + mwFee.apyMean30d
  }, [mwFloor, mwFee])

  const fundNetApy = FUND.gross - FUND.mgmt - (FUND.gross * FUND.perf) / 100
  const asOf = feed?.ok ? new Date(feed.asOf) : null

  return (
    <div className="min-h-screen bg-white font-atx-display text-ink">
      <MwNav />
      <main className="mx-auto max-w-[1080px] px-6 max-[700px]:px-4 py-[40px]">
        <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display">
          The math · never idle · never locked · always yours
        </div>
        <h1 className="font-atx-display font-bold text-[clamp(1.9rem,4.7vw,3rem)] leading-[1.04] tracking-[-0.03em] mt-2.5">
          What does your cash<br /><span className="text-gradient-accent">actually earn?</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1rem,2vw,1.14rem)] leading-[1.5] max-w-[64ch] mt-3.5">
          Real, current rates — not a slider fantasy. Every DeFi row below is a live pool pulled from
          DefiLlama: real APY, real size, real volume. Mintware’s edge is stacking the two things that
          already work — a <b className="text-ink">lending floor</b> on idle cash <i>and</i> the
          <b className="text-ink"> swap fees</b> that same cash earns as liquidity — then keeping it
          spendable. See it against a locked fund.
        </p>

        {/* deposit control */}
        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <span className="text-[11.5px] font-semibold tracking-[0.1em] uppercase text-ink-soft">Compare on a deposit of</span>
          <div className="inline-flex items-center gap-1.5">
            {[10_000, 25_000, 100_000, 500_000].map(v => (
              <button key={v} onClick={() => setDep(v)}
                className={`glass-pill px-[13px] py-[7px] text-[13px] font-semibold cursor-pointer ${dep === v ? 'text-white' : 'text-ink-mid'}`}
                style={dep === v ? { background: 'linear-gradient(135deg,var(--color-peri),var(--color-peri-deep))' } : {}}>
                {fmtUsd(v)}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-ink-soft">· held for one year</span>
        </div>

        {/* source line */}
        <div className="mt-4 text-[12px] text-ink-soft flex items-center gap-2 flex-wrap">
          {feed == null && <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-peri)] animate-pulse" />Loading live rates…</span>}
          {feed?.ok && asOf && <>Live from <a href={feed.sourceUrl} target="_blank" rel="noreferrer" className="text-peri-deep font-semibold underline underline-offset-2">DefiLlama</a> · as of {asOf.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · APY shown is <b className="text-ink-mid">fee/supply only</b> (token-reward bribes excluded)</>}
          {feed?.ok === false && <span className="text-[var(--color-coral2-deep)]">Couldn’t load live rates right now — the mechanics below still hold; refresh to retry.</span>}
        </div>

        {/* table */}
        <div className="mt-4 overflow-x-auto soft-card p-0">
          <table className="w-full border-collapse min-w-[720px] text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-[0.09em] text-ink-soft font-semibold">
                <Th className="pl-5">Strategy</Th>
                <Th>Live APY</Th>
                <Th>On {fmtUsd(dep)} / yr</Th>
                <Th>Liquidity</Th>
                <Th className="pr-5">Fees you keep?</Th>
              </tr>
            </thead>
            <tbody>
              {feed == null && [0, 1, 2, 3].map(i => (
                <tr key={i} className="border-t border-hair-soft">
                  <td colSpan={5} className="px-5 py-4"><div className="h-5 rounded bg-ground-cool animate-pulse" /></td>
                </tr>
              ))}

              {feed?.ok && (
                <>
                  <SectionRow label="The floor — idle cash, lent out" note="Your money doesn’t sit still. Fully liquid, no market risk." />
                  {floor.map(r => <DataRow key={r.key} r={r} dep={dep} />)}

                  <SectionRow label="The fees — same cash, now liquidity" note="Swaps pay you. On stable pairs there’s no meaningful IL, so the fees are yours to keep." />
                  {fees.map(r => <DataRow key={r.key} r={r} dep={dep} />)}

                  {volatile.length > 0 && (
                    <>
                      <SectionRow label="For contrast — a volatile pool" note="Big APY headline, but impermanent loss quietly eats it. This is the trap Mintware avoids." />
                      {volatile.map(r => <DataRow key={r.key} r={r} dep={dep} />)}
                    </>
                  )}

                  {/* Mintware — the honest projection */}
                  <tr className="border-t-2" style={{ borderColor: 'var(--color-peri)' }}>
                    <td className="pl-5 py-4 align-top" style={{ background: 'linear-gradient(100deg, rgba(108,108,240,.09), transparent)' }}>
                      <div className="font-atx-display font-semibold text-[15px] flex items-center gap-2">
                        Mintware <span className="text-[9.5px] font-semibold tracking-[0.05em] uppercase text-[var(--color-coral2-deep)] border border-[color-mix(in_srgb,var(--color-coral2-deep)_40%,transparent)] rounded-full px-1.5 py-[1px]">projected</span>
                      </div>
                      <div className="text-[11.5px] text-ink-soft mt-1 max-w-[26ch]">
                        {mwFloor && mwFee ? <>The floor + the fees, stacked on one dollar ({mwFloor.label.split('·')[0].trim()} + {mwFee.symbol}). Testnet, unaudited.</> : 'Floor + fees, stacked.'}
                      </div>
                    </td>
                    <td className="py-4 align-top" style={{ background: 'linear-gradient(100deg, rgba(108,108,240,.09), transparent)' }}>
                      <div className="font-atx-display font-bold text-[22px] text-gradient-accent num leading-none">{pct(stackApy)}</div>
                      <div className="text-[10.5px] text-ink-soft mt-1">{mwFloor && mwFee ? `${pct(mwFloor.apyBase)} floor + ${pct(mwFee.apyBase)} fees` : 'stacked'}{stackApy30 != null ? ` · ${pct(stackApy30)} on 30-day avg` : ''}<br />+ MEV recapture (upside, not counted)</div>
                    </td>
                    <td className="py-4 align-top" style={{ background: 'linear-gradient(100deg, rgba(108,108,240,.09), transparent)' }}>
                      <div className="font-atx-display font-bold text-[17px] num text-ink">{stackApy != null ? money(dep * stackApy / 100) : '—'}</div>
                    </td>
                    <td className="py-4 align-top" style={{ background: 'linear-gradient(100deg, rgba(108,108,240,.09), transparent)' }}>
                      <Chip tone="peri">Liquid + spendable</Chip>
                    </td>
                    <td className="pr-5 py-4 align-top" style={{ background: 'linear-gradient(100deg, rgba(108,108,240,.09), transparent)' }}>
                      <span className="text-[12.5px] text-ink">Yes — stable-pair fees, IL ≈ 0</span>
                    </td>
                  </tr>

                  {/* Traditional fund */}
                  <tr className="border-t border-hair">
                    <td className="pl-5 py-4 align-top">
                      <div className="font-atx-display font-semibold text-[15px] flex items-center gap-2">
                        Traditional fund <span className="text-[9.5px] font-semibold tracking-[0.05em] uppercase text-ink-soft border border-hair rounded-full px-1.5 py-[1px]">illustrative</span>
                      </div>
                      <div className="text-[11.5px] text-ink-soft mt-1 max-w-[26ch]">“2 and 20”: {FUND.gross}% gross, minus {FUND.mgmt}% of assets + {FUND.perf}% of gains.</div>
                    </td>
                    <td className="py-4 align-top">
                      <div className="font-atx-display font-bold text-[22px] num text-ink leading-none">{fundNetApy.toFixed(1)}%</div>
                      <div className="text-[10.5px] text-ink-soft mt-1">{FUND.gross}% gross − fees<br />net to you</div>
                    </td>
                    <td className="py-4 align-top">
                      <div className="font-atx-display font-bold text-[17px] num text-ink">{money(dep * fundNetApy / 100)}</div>
                      <div className="text-[10.5px] text-ink-soft mt-0.5">− {money(dep * FUND.mgmt / 100 + dep * FUND.gross / 100 * FUND.perf / 100)} in fees</div>
                    </td>
                    <td className="py-4 align-top"><Chip tone="mute">Locked / gated</Chip></td>
                    <td className="pr-5 py-4 align-top"><span className="text-[12.5px] text-ink-soft">Fees taken off the top</span></td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* takeaway */}
        {feed?.ok && stackApy != null && (
          <div className="mt-4 rounded-[12px] px-4 py-3.5 text-[13.5px] text-ink leading-[1.5]" style={{ background: 'rgba(17,163,126,.10)', border: '1px solid color-mix(in srgb,#11a37e 28%,transparent)' }}>
            Fee rates swing week to week (watch the 30-day averages), so the honest read isn’t a yield blowout — floor + fees lands
            in the <b>same ballpark as a good fund’s net</b>. The edge is what the fund can’t match: on {fmtUsd(dep)} the fund keeps
            <b> {money(dep * FUND.mgmt / 100 + dep * FUND.gross / 100 * FUND.perf / 100)}</b> of your return in fees and locks the
            principal, while Mintware takes <b>no management cut</b>, stays <b style={{ color: '#11a37e' }}>liquid and spendable</b>,
            and you self-custody — with MEV recapture as upside on top.
          </div>
        )}

        {/* how it stacks */}
        <h2 className="font-atx-display font-bold text-[clamp(1.3rem,2.8vw,1.7rem)] tracking-[-0.02em] mt-10 mb-3">How Mintware gets both at once</h2>
        <div className="grid grid-cols-3 max-[720px]:grid-cols-1 gap-3.5">
          {[
            { n: '1', t: 'Idle cash earns the floor', d: 'Deposits that aren’t mid-swap are lent out (Aave / Morpho / Euler) — the same lending rate you see in the top rows. That’s the baseline, always on.' },
            { n: '2', t: 'The same cash earns fees', d: 'A V4 hook pulls that capital in just-in-time to back each swap, so one dollar earns the lending floor and the swap fee — not one or the other.' },
            { n: '3', t: 'And it stays spendable', d: 'The balance is usable as USDC (cards, x402, settlement) while it earns — a spend is a hold against the position, not an exit. No lock, no redemption gate.' },
          ].map(s => (
            <div key={s.n} className="soft-card p-[18px]">
              <div className="w-7 h-7 rounded-full grid place-items-center text-[13px] font-bold text-white mb-2.5" style={{ background: 'linear-gradient(135deg,var(--color-peri),var(--color-peri-deep))' }}>{s.n}</div>
              <h4 className="font-atx-display m-0 mb-1.5 text-[15px] font-semibold tracking-[-0.01em]">{s.t}</h4>
              <p className="m-0 text-[13px] text-ink-mid leading-[1.55]">{s.d}</p>
            </div>
          ))}
        </div>

        <p className="text-[11.5px] text-ink-soft leading-[1.6] max-w-[84ch] mt-7">
          <b className="text-ink-mid">What’s real and what’s not.</b> The lending, stable-fee, and volatile rows are live pools
          from DefiLlama — real APY (fee/supply component only, token-reward bribes excluded), real TVL, real volume, as of the
          timestamp above; rates move, so the numbers change when you reload. The <b className="text-ink-mid">Mintware</b> row is a
          projection — the two real rows above it, stacked on the same capital (the mechanism Mintware’s vaults implement) — not a
          measured live yield: <b className="text-ink-mid">the vaults are on Base Sepolia testnet, unaudited, empty; external audit
          gates real value.</b> MEV recapture is real mechanism but not counted in the figure. The fund row is an illustrative
          2-and-20, not a specific product. Crypto yield is taxable income; this is not investment or tax advice. “Off the traditional
          rails” here means self-custody and no intermediary rent — not invisibility to anyone.
        </p>
      </main>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`py-3 pr-4 font-semibold ${className}`}>{children}</th>
}

function SectionRow({ label, note }: { label: string; note: string }) {
  return (
    <tr className="bg-ground-cool border-t border-hair">
      <td colSpan={5} className="px-5 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-mid">{label}</span>
        <span className="text-[11.5px] text-ink-soft ml-2 font-normal normal-case tracking-normal">{note}</span>
      </td>
    </tr>
  )
}

function DataRow({ r, dep }: { r: Row; dep: number }) {
  const apy = r.apyBase ?? 0
  const isVol = r.kind === 'volatile'
  return (
    <tr className="border-t border-hair-soft">
      <td className="pl-5 py-3.5 align-top">
        <div className="font-atx-display font-semibold text-[14px] flex items-center gap-2">
          {r.label}
          <span className="text-[10px] font-medium text-ink-soft border border-hair rounded-full px-1.5 py-[1px]">{r.chain}</span>
        </div>
        <div className="text-[11.5px] text-ink-soft mt-1 max-w-[30ch]">{r.blurb}</div>
        <div className="text-[10.5px] text-ink-soft mt-1 num">
          {fmtUsd(r.tvlUsd)} TVL{r.volumeUsd1d ? ` · ${fmtUsd(r.volumeUsd1d)}/day volume` : ''}
        </div>
      </td>
      <td className="py-3.5 align-top">
        <div className="font-atx-display font-bold text-[20px] num leading-none" style={{ color: isVol ? 'var(--color-coral2-deep)' : 'var(--color-peri-deep)' }}>{pct(apy)}</div>
        {r.apyMean30d != null && <div className="text-[10.5px] text-ink-soft mt-1 num">{pct(r.apyMean30d)} 30-day avg</div>}
      </td>
      <td className="py-3.5 align-top">
        <div className="font-atx-display font-semibold text-[16px] num text-ink">{money(dep * apy / 100)}</div>
      </td>
      <td className="py-3.5 align-top">
        <Chip tone="good">Liquid</Chip>
      </td>
      <td className="pr-5 py-3.5 align-top">
        {isVol
          ? <span className="text-[12.5px] text-[var(--color-coral2-deep)]">No — IL risk erodes it</span>
          : <span className="text-[12.5px] text-ink">{r.kind === 'fees' ? 'Yes — IL ≈ 0 on stables' : 'N/A — no market risk'}</span>}
      </td>
    </tr>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone: 'good' | 'peri' | 'mute' }) {
  const s = tone === 'peri'
    ? { color: 'var(--color-peri-deep)', bg: 'rgba(108,108,240,.12)' }
    : tone === 'good'
      ? { color: '#11a37e', bg: 'rgba(17,163,126,.12)' }
      : { color: 'var(--color-ink-soft)', bg: 'var(--color-ground-cool)' }
  return <span className="inline-block text-[11.5px] font-semibold rounded-full px-2 py-[3px] whitespace-nowrap" style={{ color: s.color, background: s.bg }}>{children}</span>
}

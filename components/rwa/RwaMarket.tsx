'use client'

// V2-RWAs — the live market view for one RWA liquidity unit. Everything numeric is read from Base Sepolia
// via /api/rwa/unit (polled); the proof panel renders the recorded lifecycle run (config/rwaDemo.json).
// Light-only, V2 design system. Testnet + unaudited, fictional property, valueless tokens — said on-page.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { RWA_DEMO, revertReasonText, RWA_CONTRACT_ROWS, RWA_CHAIN, txUrl, addrUrl, verifiedSourceUrl, shortHash, walletLabel } from '@/lib/rwa/demo'

type Unit = {
  ok: boolean
  block: number
  blockTime: number
  appraisal: { tick: number; usd: number; at: number; fresh: boolean; oracleReady: boolean; maxAgeSecs: number | null; minUpdateSecs: number | null }
  spot: { tick: number; usd: number; deviationTicks: number; inCore: boolean; inSpec: boolean }
  band: { core: [number, number]; spec: [number, number]; coreFeePct: number; specFeePct: number } | null
  tradingPaused: boolean
  vault: { seniorUsd: number; deployedUsd: number; juniorUnits: number; juniorUsd: number; lockExpiry: number }
  lending: { balanceUsd: number; pendingUsd: number; aprPct: number; interestMintedUsd: number; simulated: boolean }
  trades: { tx: string; block: number; ts: number | null; trader: string | null; side: 'buy' | 'sell'; usd: number; units: number; priceUsd: number }[]
  tradeCount: number
  priceSeries: { block: number; ts: number | null; usd: number; byVault: boolean }[]
  appraisalSeries: { block: number; ts: number | null; usd: number }[]
}

const WRAP = 'max-w-[1120px] mx-auto px-6 max-sm:px-4'
const EY = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft'
const H2 = 'font-atx-display font-semibold text-ink tracking-[-0.02em] text-[clamp(1.35rem,2.2vw,1.75rem)]'
const usd = (n: number, d = 0) => `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const ago = (secs: number) => {
  if (secs < 90) return `${Math.max(1, Math.round(secs))}s ago`
  if (secs < 5400) return `${Math.round(secs / 60)} min ago`
  if (secs < 172800) return `${Math.round(secs / 3600)} h ago`
  return `${Math.round(secs / 86400)} days ago`
}
const displayLabel = (l: string) => l.replace(' deposits ', ' supplies ')

export function RwaMarket() {
  const [unit, setUnit] = useState<Unit | null>(null)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now() / 1000)

  const load = useCallback((fresh = false) =>
    fetch(`/api/rwa/unit${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: Unit) => { if (d.ok) { setUnit(d); setFailed(false) } else setFailed(true) })
      .catch(() => setFailed(true)), [])

  useEffect(() => {
    load()
    const poll = setInterval(() => load(), 12_000)
    const tick = setInterval(() => setNow(Date.now() / 1000), 1_000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  // Interest keeps accruing between polls: extrapolate client-side at the venue's rate.
  const interest = useMemo(() => {
    if (!unit) return null
    const perSec = (unit.lending.balanceUsd * unit.lending.aprPct) / 100 / (365 * 86400)
    const since = Math.max(0, now - unit.blockTime)
    return unit.lending.interestMintedUsd + unit.lending.pendingUsd + perSec * since
  }, [unit, now])

  const p = RWA_DEMO.property
  const status = !unit ? null
    : unit.tradingPaused ? { t: 'Trading paused', c: 'text-[#B4532A] bg-[rgba(232,138,103,0.14)]' }
    : !unit.appraisal.fresh && unit.appraisal.oracleReady ? { t: 'Appraisal stale — trading halted, LP exit window open', c: 'text-[#B4532A] bg-[rgba(232,138,103,0.14)]' }
    : !unit.appraisal.fresh ? { t: 'Appraisal expired — awaiting a new appraisal', c: 'text-[#B4532A] bg-[rgba(232,138,103,0.14)]' }
    : unit.spot.inCore ? { t: 'Inside the core band', c: 'text-[#2F7D5B] bg-[rgba(47,125,91,0.10)]' }
    : unit.spot.inSpec ? { t: 'Inside the band', c: 'text-peri-deep bg-[rgba(108,108,240,0.10)]' }
    : { t: 'Outside the band — gap-closing trades only', c: 'text-[#B4532A] bg-[rgba(232,138,103,0.14)]' }

  const lendShare = unit ? unit.lending.balanceUsd / Math.max(1, unit.lending.balanceUsd + unit.vault.deployedUsd) : null

  return (
    <div className="bg-white min-h-screen text-ink">
      {/* HEADER */}
      <section className="border-b border-hair-soft bg-[linear-gradient(180deg,#F6F6FC_0%,#FFFFFF_100%)]">
        <div className={`${WRAP} pt-10 pb-9`}>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href="/app/rwa" className="text-[13px] text-ink-mid no-underline hover:text-peri-deep">RWA liquidity</Link>
            <span className="text-ink-soft">/</span>
            <span className="text-[13px] text-ink">{p.symbol}</span>
            <span className="ml-1 rounded-full border border-hair px-2.5 py-0.5 text-[11.5px] font-semibold text-ink-mid">Testnet demo · {RWA_CHAIN.name} · unaudited</span>
            <LiveDot block={unit?.block} failed={failed} />
          </div>

          <div className="mt-5 grid grid-cols-[1.4fr_1fr] gap-8 max-[860px]:grid-cols-1">
            <div>
              <h1 className="font-atx-display font-semibold tracking-[-0.03em] leading-[1.05] text-[clamp(2rem,4vw,3rem)]">{p.name.replace(' (demo)', '')}</h1>
              <p className="mt-3 max-w-[58ch] text-[15px] leading-[1.6] text-ink-mid">
                A fictional land parcel, tokenized as a permissioned asset. Anyone can supply liquidity in dollars; only
                verified holders can receive the token. Idle liquidity sits in a lending venue until a trade needs it.
              </p>
            </div>
            <div className="rounded-[20px] border border-hair bg-white p-6 shadow-[0_1px_2px_rgba(23,23,31,.04)]">
              <div className={EY}>Price per {p.symbol}</div>
              <div className="mt-2 flex items-end gap-3">
                <div className="font-atx-display text-[40px] font-semibold leading-none tracking-[-0.02em]">{unit ? usd(unit.spot.usd, 2) : '—'}</div>
                {unit && <div className="pb-1 text-[13px] text-ink-mid">pool spot</div>}
              </div>
              <div className="mt-3 flex items-center justify-between text-[13.5px]">
                <span className="text-ink-mid">Appraised value</span>
                <span className="font-semibold">{unit ? usd(unit.appraisal.usd, 2) : '—'}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[13.5px]">
                <span className="text-ink-mid">Last appraisal</span>
                <span>{unit ? ago(now - unit.appraisal.at) : '—'}</span>
              </div>
              {status && <div className={`mt-4 inline-flex rounded-full px-3 py-1 text-[12.5px] font-semibold ${status.c}`}>{status.t}</div>}
              <LiveTradeButton onTraded={() => { load(true); setTimeout(() => load(true), 4000) }} />
            </div>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-8 grid grid-cols-4 gap-4 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1`}>
          <Kpi label="Liquidity supplied" value={unit ? usd(unit.vault.seniorUsd) : '—'} sub="senior tranche, in dUSD" />
          <Kpi label="Earning in lending" value={unit ? usd(unit.lending.balanceUsd) : '—'} sub={lendShare !== null ? `${Math.round(lendShare * 100)}% of liquidity, waiting` : '—'} accent />
          <Kpi label="In the pool" value={unit ? usd(unit.vault.deployedUsd) : '—'} sub={unit ? `beside ${Math.round(unit.vault.juniorUnits).toLocaleString()} issuer ${p.symbol}` : '—'} />
          <Kpi label="Interest earned" value={interest !== null ? usd(interest, 4) : '—'} sub={unit ? `simulated ${unit.lending.aprPct}% testnet rate, live` : '—'} accent mono />
        </div>
      </section>

      {/* CHART */}
      <section className="border-b border-hair-soft bg-[#FBFBFE]">
        <div className={`${WRAP} py-10`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className={EY}>Price vs appraisal</div>
              <h2 className={`${H2} mt-1.5`}>Trading stays anchored to the appraised value</h2>
            </div>
            {unit?.band && (
              <div className="flex flex-wrap gap-4 text-[12.5px] text-ink-mid">
                <Legend swatch="bg-[rgba(108,108,240,0.22)]" text={`Core band ${usd(unit.band.core[0], 2)}–${usd(unit.band.core[1], 2)} · ${unit.band.coreFeePct}% fee`} />
                <Legend swatch="bg-[rgba(108,108,240,0.09)]" text={`Hard band ${usd(unit.band.spec[0], 2)}–${usd(unit.band.spec[1], 2)} · ${unit.band.specFeePct}% fee`} />
              </div>
            )}
          </div>
          <div className="mt-5 rounded-[20px] border border-hair bg-white p-4">
            {unit ? <PriceBandChart unit={unit} /> : <div className="h-[260px] mw-shimmer rounded-[12px]" />}
          </div>
          <p className="mt-3 text-[12.5px] text-ink-soft">Each point is a swap read from the pool on {RWA_CHAIN.name}. A trade that would end outside the hard band is refused by the hook, unless it moves the price back toward the appraisal.</p>
        </div>
      </section>

      {/* THREE ROLES */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-10`}>
          <div className={EY}>How a trade clears</div>
          <h2 className={`${H2} mt-1.5`}>Permissionless liquidity, compliant ownership</h2>
          <div className="mt-6 grid grid-cols-3 gap-4 max-[820px]:grid-cols-1">
            <Role tag="Open" title="Liquidity providers" body="Supply dUSD to the senior tranche. They never hold the property token, so its transfer rules never reach them. They exit in dUSD." />
            <Role tag="Enrolled once" title="The pool + vault" body="A standard Uniswap v4 pool. The pool manager, the vault and the router are enrolled as permitted holders, once, by the issuer." />
            <Role tag="Verified" title="Traders" body="Checked at the moment they receive the token. The token itself refuses an unverified wallet — see the reverted transaction below." />
          </div>
        </div>
      </section>

      {/* TRADES */}
      <section className="border-b border-hair-soft bg-[#FBFBFE]">
        <div className={`${WRAP} py-10`}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className={EY}>Trades</div>
              <h2 className={`${H2} mt-1.5`}>Settled on-chain{unit ? ` · ${unit.tradeCount}` : ''}</h2>
            </div>
          </div>
          <div className="mt-5 overflow-x-auto rounded-[20px] border border-hair bg-white">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="border-b border-hair text-left text-[11.5px] uppercase tracking-[0.1em] text-ink-soft">
                  <th className="px-5 py-3 font-semibold">When</th><th className="px-5 py-3 font-semibold">Trader</th>
                  <th className="px-5 py-3 font-semibold">Side</th><th className="px-5 py-3 text-right font-semibold">{p.symbol}</th>
                  <th className="px-5 py-3 text-right font-semibold">dUSD</th><th className="px-5 py-3 text-right font-semibold">Price</th>
                  <th className="px-5 py-3 text-right font-semibold">Tx</th>
                </tr>
              </thead>
              <tbody>
                {unit?.trades.length ? unit.trades.map((t) => (
                  <tr key={t.tx} className="border-b border-hair-soft last:border-0">
                    <td className="px-5 py-3 text-ink-mid">{t.ts ? ago(now - t.ts) : `block ${t.block}`}</td>
                    <td className="px-5 py-3">{t.trader ? walletLabel(t.trader) : '—'}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${t.side === 'buy' ? 'text-[#2F7D5B] bg-[rgba(47,125,91,0.10)]' : 'text-peri-deep bg-[rgba(108,108,240,0.10)]'}`}>{t.side}</span></td>
                    <td className="px-5 py-3 text-right font-atx-mono">{t.units.toFixed(3)}</td>
                    <td className="px-5 py-3 text-right font-atx-mono">{t.usd.toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-atx-mono">{usd(t.priceUsd, 2)}</td>
                    <td className="px-5 py-3 text-right"><a href={txUrl(t.tx)} target="_blank" rel="noreferrer" className="font-atx-mono text-[12.5px] text-peri-deep no-underline hover:underline">{shortHash(t.tx)} ↗</a></td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-ink-soft">{unit ? 'No trades yet.' : 'Reading the pool…'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* PROOF */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-10`}>
          <div className={EY}>Proof</div>
          <h2 className={`${H2} mt-1.5`}>Every step, a transaction you can open</h2>
          <p className="mt-2 max-w-[66ch] text-[14px] leading-[1.6] text-ink-mid">
            The full lifecycle, run on {RWA_CHAIN.name} on {new Date(RWA_DEMO.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. The two refusals
            are real transactions that were mined and reverted, the rule enforced by the chain, not a simulation.
          </p>
          <ol className="mt-6 grid gap-3">
            {RWA_DEMO.legs.map((leg) => {
              const refused = leg.txs.some((t) => t.status === 'reverted')
              return (
                <li key={leg.n} className={`rounded-[18px] border p-5 ${refused ? 'border-[rgba(232,138,103,0.45)] bg-[#FFF8F4]' : 'border-hair bg-white'}`}>
                  <div className="flex items-start gap-4">
                    <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12.5px] font-bold ${refused ? 'bg-[rgba(232,138,103,0.2)] text-[#B4532A]' : 'bg-[rgba(108,108,240,0.12)] text-peri-deep'}`}>{leg.n}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[15.5px]">{leg.title}</h3>
                        {refused && <span className="rounded-full bg-[rgba(232,138,103,0.18)] px-2 py-0.5 text-[11.5px] font-semibold text-[#B4532A]">Refused on-chain</span>}
                      </div>
                      <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-mid">{leg.desc}</p>
                      <ul className="mt-3 grid gap-1.5">
                        {leg.txs.map((t) => (
                          <li key={t.hash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
                            <span className="text-ink">
                              {t.status === 'reverted' ? '⨯ ' : '✓ '}{displayLabel(t.label)}
                              {revertReasonText(t) && <span className="block text-[12px] text-[#B4532A]">{revertReasonText(t)}</span>}
                            </span>
                            <a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="font-atx-mono text-[12.5px] text-peri-deep no-underline hover:underline">{shortHash(t.hash)} ↗</a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      {/* CONTRACTS */}
      <section className="border-b border-hair-soft bg-[#FBFBFE]">
        <div className={`${WRAP} py-10`}>
          <div className={EY}>Contracts</div>
          <h2 className={`${H2} mt-1.5`}>Deployed and source-verified on {RWA_CHAIN.name}</h2>
          <div className="mt-5 overflow-x-auto rounded-[20px] border border-hair bg-white">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <tbody>
                {RWA_CONTRACT_ROWS.map((r) => (
                  <tr key={r.key} className="border-b border-hair-soft last:border-0">
                    <td className="px-5 py-3.5"><div className="font-semibold">{r.name}</div><div className="text-[12.5px] text-ink-mid">{r.role}</div></td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <a href={addrUrl(RWA_DEMO.contracts[r.key])} target="_blank" rel="noreferrer" className="font-atx-mono text-[12.5px] text-ink-mid no-underline hover:text-peri-deep">{shortHash(RWA_DEMO.contracts[r.key])}</a>
                      <a href={verifiedSourceUrl(r.key, RWA_DEMO.contracts[r.key])} target="_blank" rel="noreferrer" className="ml-3 rounded-full bg-[rgba(47,125,91,0.10)] px-2 py-0.5 text-[11.5px] font-semibold text-[#2F7D5B] no-underline">Verified source ↗</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* DISCLOSURE */}
      <section>
        <div className={`${WRAP} py-8`}>
          <p className="max-w-[86ch] text-[12px] leading-[1.6] text-ink-soft">
            Testnet demonstration on {RWA_CHAIN.name}. The property is fictional; dUSD and {p.symbol} are valueless test tokens; the
            lending yield is simulated. The contracts are unaudited. A liquidity position is not a deposit, a savings product, or a
            guaranteed or fixed return. Nothing here is an offer of securities or of any investment.{' '}
            <Link href="/legal" className="font-semibold text-peri-deep no-underline hover:underline">Legal →</Link>
          </p>
        </div>
      </section>
    </div>
  )
}

/** Operator-only: signs a message, the server places ONE real trade from the verified demo-trader wallet. */
function LiveTradeButton({ onTraded }: { onTraded: () => void }) {
  const { address, isConnected } = useMintwareIdentity()
  const { signMessageAsync } = useSignMessage()
  const [state, setState] = useState<{ busy: boolean; msg?: string; hash?: string; ok?: boolean }>({ busy: false })
  if (!isConnected || !address) return null

  const run = async () => {
    setState({ busy: true, msg: 'Sign to place a live trade…' })
    try {
      const res = await signedOrgFetch({ path: '/api/rwa/live-trade', action: 'mintware-rwa-live-trade', address, signMessageAsync })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.success) {
        const why: Record<string, string> = {
          not_an_operator: 'This wallet is not a demo operator.', cooldown: 'One trade at a time — try again in a few seconds.',
          trade_in_flight: 'A trade is already settling.', operators_unset: 'Live trading is not configured on this deploy.',
          trader_not_configured: 'The demo trader is not configured on this deploy.', appraisal_stale: 'The appraisal is stale; trading is halted.',
        }
        setState({ busy: false, ok: false, msg: why[j.error] ?? 'The trade did not go through.' })
        return
      }
      setState({ busy: false, ok: true, hash: j.hash, msg: `Settled: the demo trader ${j.side === 'buy' ? 'bought with' : 'sold'} ${j.amount}` })
      onTraded()
    } catch {
      setState({ busy: false, ok: false, msg: 'Signature declined.' })
    }
  }

  return (
    <div className="mt-4 border-t border-hair-soft pt-4">
      <button onClick={run} disabled={state.busy} className="glass-pill-primary glass-pill-sm w-full disabled:opacity-60">
        {state.busy ? 'Settling on Base Sepolia…' : 'Run a live trade'}
      </button>
      {state.msg && (
        <p className={`mt-2 text-[12.5px] ${state.ok === false ? 'text-[#B4532A]' : 'text-ink-mid'}`}>
          {state.msg}
          {state.hash && <> · <a href={txUrl(state.hash)} target="_blank" rel="noreferrer" className="font-atx-mono text-peri-deep no-underline hover:underline">{shortHash(state.hash)} ↗</a></>}
        </p>
      )}
    </div>
  )
}

function LiveDot({ block, failed }: { block?: number; failed: boolean }) {
  if (failed && !block) return <span className="text-[12px] text-ink-soft">Live read unavailable — showing the recorded run</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-mid">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mw-live opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-mw-live" /></span>
      {block ? <>Live · block <span className="font-atx-mono">{block.toLocaleString()}</span></> : 'Connecting…'}
    </span>
  )
}

function Kpi({ label, value, sub, accent, mono }: { label: string; value: string; sub: string; accent?: boolean; mono?: boolean }) {
  return (
    <div className={`rounded-[18px] border p-5 ${accent ? 'border-[rgba(108,108,240,0.28)] bg-[rgba(108,108,240,0.05)]' : 'border-hair bg-white'}`}>
      <div className={EY}>{label}</div>
      <div className={`mt-2 text-[26px] font-semibold leading-none tracking-[-0.01em] ${mono ? 'font-atx-mono text-[22px]' : 'font-atx-display'}`}>{value}</div>
      <div className="mt-2 text-[12.5px] text-ink-mid">{sub}</div>
    </div>
  )
}

function Role({ tag, title, body }: { tag: string; title: string; body: string }) {
  return (
    <div className="rounded-[18px] border border-hair bg-white p-6">
      <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-peri-deep">{tag}</div>
      <h3 className="mt-2 font-atx-display text-[18px] font-semibold">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-mid">{body}</p>
    </div>
  )
}

function Legend({ swatch, text }: { swatch: string; text: string }) {
  return <span className="inline-flex items-center gap-2"><span className={`h-3 w-5 rounded-[3px] ${swatch}`} />{text}</span>
}

/** Spot price (from on-chain swaps) against the appraisal and its core / hard bands. The x-axis is the EVENT
 *  SEQUENCE (each swap / appraisal one step, then "now") — a thin RWA market trades in bursts, so a block-scaled
 *  axis would stack every trade into one column. */
function PriceBandChart({ unit }: { unit: Unit }) {
  const W = 1000, H = 290, PL = 64, PR = 20, PT = 16, PB = 34
  const cfg = RWA_DEMO.hookConfig
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

  // Walk the sequence: appraisal steps define bands; spot starts AT the first appraisal (the pool launches there).
  let appraisal = events.find((e) => e.kind === 'appraisal')?.usd ?? unit.appraisal.usd
  let spot = appraisal
  const slots: { appraisal: number; spot: number; ev: Ev | null }[] = [{ appraisal, spot, ev: null }]
  for (const e of events) {
    if (e.kind === 'appraisal') { appraisal = e.usd; if (slots.length === 1) { slots[0].appraisal = appraisal; slots[0].spot = appraisal; spot = appraisal; continue } }
    else spot = e.usd
    slots.push({ appraisal, spot, ev: e })
  }
  slots.push({ appraisal: unit.appraisal.usd, spot: unit.spot.usd, ev: null }) // now

  const n = slots.length
  const X = (i: number) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR)
  const allY = slots.flatMap((s) => [s.spot, s.appraisal * specF, s.appraisal / specF])
  const y0 = Math.min(...allY) * 0.99, y1 = Math.max(...allY) * 1.01
  const Y = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB)
  const ticks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4)
  const half = (W - PL - PR) / Math.max(1, n - 1) / 2
  const line = slots.map((s, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(s.spot).toFixed(1)}`).join(' ')

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${RWA_DEMO.property.symbol} spot price against its appraisal band`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} stroke="rgba(23,23,31,0.06)" />
            <text x={PL - 10} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="#9A9AA8">${v.toFixed(2)}</text>
          </g>
        ))}
        {slots.map((s, i) => {
          const xa = Math.max(PL, X(i) - half), xb = Math.min(W - PR, X(i) + half)
          return (
            <g key={`band${i}`}>
              <rect x={xa} width={xb - xa} y={Y(s.appraisal * specF)} height={Y(s.appraisal / specF) - Y(s.appraisal * specF)} fill="rgba(108,108,240,0.08)" />
              <rect x={xa} width={xb - xa} y={Y(s.appraisal * coreF)} height={Y(s.appraisal / coreF) - Y(s.appraisal * coreF)} fill="rgba(108,108,240,0.15)" />
              <line x1={xa} x2={xb} y1={Y(s.appraisal)} y2={Y(s.appraisal)} stroke="#5A57DE" strokeDasharray="5 4" strokeWidth="1.25" />
            </g>
          )
        })}
        <path d={line} fill="none" stroke="#17171F" strokeWidth="1.75" strokeLinejoin="round" />
        {slots.map((s, i) => {
          if (!s.ev) return <circle key={`p${i}`} cx={X(i)} cy={Y(s.spot)} r={i === n - 1 ? 4.5 : 3} fill={i === n - 1 ? '#17171F' : '#fff'} stroke="#17171F" strokeWidth="1.5" />
          if (s.ev.kind === 'appraisal') return <rect key={`p${i}`} x={X(i) - 4} y={Y(s.appraisal) - 4} width="8" height="8" transform={`rotate(45 ${X(i)} ${Y(s.appraisal)})`} fill="#5A57DE" />
          return <circle key={`p${i}`} cx={X(i)} cy={Y(s.spot)} r="3.4" fill={s.ev.byVault ? '#F4A183' : '#fff'} stroke={s.ev.byVault ? '#E88A67' : '#17171F'} strokeWidth="1.5" />
        })}
        <text x={X(n - 1) - 8} y={Y(unit.spot.usd) + (unit.spot.usd < unit.appraisal.usd ? 18 : -10)} textAnchor="end" fontSize="12" fontWeight="600" fill="#17171F">now ${unit.spot.usd.toFixed(2)}</text>
        <text x={X(n - 1) - 8} y={Y(unit.appraisal.usd) - 8} textAnchor="end" fontSize="11.5" fontWeight="600" fill="#5A57DE">appraisal ${unit.appraisal.usd.toFixed(2)}</text>
        <text x={PL} y={H - 10} fontSize="11" fill="#9A9AA8">pool opened at the appraisal</text>
        <text x={W - PR} y={H - 10} textAnchor="end" fontSize="11" fill="#9A9AA8">now · block {unit.block.toLocaleString()}</text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 px-1 text-[12px] text-ink-mid">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink bg-white" />trade</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[#E88A67] bg-[#F4A183]" />vault unwind (an LP exit)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 bg-peri-deep" />new appraisal</span>
      </div>
    </div>
  )
}

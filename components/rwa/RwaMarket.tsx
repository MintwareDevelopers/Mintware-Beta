'use client'

// V2-RWAs — the live market for one RWA liquidity unit. Every number is read from the chain via /api/rwa/unit
// (useRwaUnit, polled). The lifecycle proof + contracts live on /app/rwa/proof. Light-only.

import { useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { getUnit, explorer, shortHash, walletLabel, RWA_UNITS } from '@/lib/rwa/demo'
import { useRwaUnit, usd, ago, rwaStatus, STATUS_CLS } from './useRwaUnit'
import { BandGauge, LiquidityMap, PriceBandChart, LiveDot, Disclosure, EY, H2 } from './RwaVisuals'
import { SupplyPanel } from './SupplyPanel'

const WRAP = 'max-w-[1160px] mx-auto px-8 max-[900px]:px-5'

export function RwaMarket({ slug }: { slug: string }) {
  const u = getUnit(slug) ?? RWA_UNITS[0]
  const D = u.demo
  const ex = explorer(u)
  const { unit, failed, now, interest, reload } = useRwaUnit(u.slug)
  const status = rwaStatus(unit)
  const p = D.property

  return (
    <div className="text-ink">
      {/* HEADER */}
      <section className="border-b border-hair-soft bg-[radial-gradient(1000px_360px_at_90%_-20%,rgba(108,108,240,0.12),transparent_60%)]">
        <div className={`${WRAP} pt-9 pb-8`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-hair bg-white px-2.5 py-0.5 text-[11.5px] font-semibold text-ink-mid">Testnet · unaudited · fictional property</span>
              <LiveDot block={unit?.block} failed={failed} />
            </div>
            <div className="inline-flex rounded-full border border-hair bg-white p-1" role="tablist" aria-label="Chain">
              {RWA_UNITS.map((x) => (
                <Link
                  key={x.slug}
                  href={`/app/rwa/${x.slug}`}
                  role="tab"
                  aria-selected={x.slug === u.slug}
                  className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold no-underline transition-colors ${x.slug === u.slug ? 'bg-[rgba(108,108,240,0.12)] text-peri-deep' : 'text-ink-mid hover:text-ink'}`}
                >
                  {x.chain.name}
                </Link>
              ))}
            </div>
          </div>
          <h1 className="mt-5 font-atx-display text-[clamp(2rem,4vw,3.1rem)] font-semibold leading-[1.04] tracking-[-0.035em]">{p.name.replace(' (demo)', '')}</h1>
          <p className="mt-2 text-[14px] text-ink-mid">{p.symbol} / dUSD · Uniswap v4{D.poolManagerDeployedByUs ? ' (our v4-core deployment)' : ''} · {u.chain.name}</p>
        </div>
      </section>

      {/* INSTRUMENT */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-9 grid grid-cols-[1.25fr_1fr] gap-5 max-[980px]:grid-cols-1`}>
          <div className="rounded-[24px] border border-hair bg-white p-7 shadow-[0_1px_2px_rgba(23,23,31,0.04),0_18px_48px_-24px_rgba(59,58,143,0.25)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className={EY}>Price per {p.symbol}</div>
                <div className="mt-2 font-atx-display text-[52px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{unit ? usd(unit.spot.usd, 2) : '—'}</div>
                <div className="mt-2 text-[13px] text-ink-mid">
                  appraisal <span className="font-semibold text-peri-deep">{unit ? usd(unit.appraisal.usd, 2) : '—'}</span>
                  {unit && <> · {ago(now - unit.appraisal.at)}</>}
                </div>
              </div>
              {status && <span className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${STATUS_CLS[status.tone]}`}>{status.t}</span>}
            </div>
            <div className="mt-8">{unit ? <BandGauge unit={unit} demo={D} /> : <div className="h-[110px] mw-shimmer rounded-[14px]" />}</div>
            {u.liveTrade
              ? <LiveTradeButton slug={u.slug} chainName={u.chain.name} onTraded={() => { reload(true); setTimeout(() => reload(true), 4000) }} />
              : <p className="mt-5 border-t border-hair-soft pt-4 text-[12.5px] text-ink-soft">Live demo trading runs on the Base Sepolia market.</p>}
          </div>
          <div className="rounded-[24px] border border-hair bg-white p-7">
            <div className={EY}>Where the liquidity sits</div>
            <div className="mt-6">{unit ? <LiquidityMap unit={unit} interest={interest} symbol={p.symbol} /> : <div className="h-[180px] mw-shimmer rounded-[14px]" />}</div>
          </div>
        </div>
      </section>

      {/* TAKE PART — the two roles a visitor can play here */}
      <section className="border-b border-hair-soft bg-[#F7FBFA]">
        <div className={`${WRAP} py-9 grid grid-cols-2 gap-5 max-[900px]:grid-cols-1`}>
          {u.liveTrade
            ? <SupplyPanel unit={u} onChanged={() => reload(true)} />
            : (
              <div className="rounded-[24px] border border-hair bg-white p-6">
                <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#1F7A6A]">Supply liquidity</div>
                <p className="mt-3 text-[13.5px] leading-[1.55] text-ink-mid">Supplying runs on the Base Sepolia market today. This {u.chain.name} unit shows the same contracts working on a second chain.</p>
                <Link href="/app/rwa/wcp7#supply" className="glass-pill-primary mt-4 inline-flex no-underline">Supply on Base Sepolia →</Link>
              </div>
            )}
          <div className="rounded-[24px] border border-hair bg-white p-6">
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#B4532A]">Buy or sell {p.symbol}</div>
            <h3 className="mt-1.5 font-atx-display text-[19px] font-semibold tracking-[-0.01em]">Through the issuer, as a verified holder</h3>
            <p className="mt-3 text-[13.5px] leading-[1.55] text-ink-mid">
              Owning the property token is regulated, so trading happens on the issuer&apos;s licensed platform, where you are
              verified. Mintware is the liquidity underneath: every trade there clears against this pool, inside the band.
            </p>
            <ul className="mt-4 grid gap-2 text-[13px] text-ink-mid">
              <li className="flex gap-2"><span className="text-[#2F7D5B]">✓</span> Verified wallets receive the token</li>
              <li className="flex gap-2"><span className="text-[#B4532A]">⨯</span> Unverified wallets are refused by the token itself — <Link href={`/app/rwa/proof?unit=${u.slug}`} className="text-peri-deep no-underline hover:underline">see it on-chain</Link></li>
            </ul>
            <p className="mt-4 border-t border-hair-soft pt-3 text-[11.5px] leading-[1.55] text-ink-soft">In this demo, a stand-in router plays the issuer&apos;s front end{u.liveTrade ? ' — the “Run a live trade” button above uses it from a verified demo wallet' : ''}.</p>
          </div>
        </div>
      </section>

      {/* CHART */}
      <section className="border-b border-hair-soft bg-[#FAFAFD]">
        <div className={`${WRAP} py-10`}>
          <div className={EY}>Price vs appraisal</div>
          <h2 className={`${H2} mt-1.5`}>Trading stays anchored to the appraised value</h2>
          <div className="mt-6 rounded-[22px] border border-hair bg-white p-5">
            {unit ? <PriceBandChart unit={unit} demo={D} /> : <div className="h-[280px] mw-shimmer rounded-[12px]" />}
          </div>
        </div>
      </section>

      {/* TRADES */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-10`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className={EY}>Trades</div>
              <h2 className={`${H2} mt-1.5`}>Settled on-chain{unit ? ` · ${unit.tradeCount}` : ''}</h2>
            </div>
            <Link href={`/app/rwa/proof?unit=${u.slug}`} className="text-[13.5px] font-semibold text-peri-deep no-underline hover:underline">Lifecycle proof + contracts →</Link>
          </div>
          <div className="mt-5 overflow-x-auto rounded-[22px] border border-hair bg-white">
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
                  <tr key={t.tx} className="border-b border-hair-soft last:border-0 hover:bg-[#FAFAFD]">
                    <td className="px-5 py-3 text-ink-mid">{t.ts ? ago(now - t.ts) : `block ${t.block}`}</td>
                    <td className="px-5 py-3">{t.trader ? walletLabel(t.trader, D) : '—'}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${t.side === 'buy' ? 'text-[#2F7D5B] bg-[rgba(47,125,91,0.10)]' : 'text-peri-deep bg-[rgba(108,108,240,0.10)]'}`}>{t.side}</span></td>
                    <td className="px-5 py-3 text-right font-atx-mono">{t.units.toFixed(3)}</td>
                    <td className="px-5 py-3 text-right font-atx-mono">{t.usd.toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-atx-mono">{usd(t.priceUsd, 2)}</td>
                    <td className="px-5 py-3 text-right"><a href={ex.tx(t.tx)} target="_blank" rel="noreferrer" className="font-atx-mono text-[12.5px] text-peri-deep no-underline hover:underline">{shortHash(t.tx)} ↗</a></td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-ink-soft">{unit ? 'No trades yet.' : 'Reading the pool…'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section><div className={`${WRAP} py-8`}><Disclosure chainName={u.chain.name} symbol={p.symbol} /></div></section>
    </div>
  )
}

/** Operator-only: signs a message, the server places ONE real trade from the verified demo-trader wallet. */
function LiveTradeButton({ onTraded, chainName, slug }: { onTraded: () => void; chainName: string; slug: string }) {
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
    <div className="mt-6 border-t border-hair-soft pt-5">
      <button onClick={run} disabled={state.busy} className="glass-pill-primary w-full disabled:opacity-60">
        {state.busy ? `Settling on ${chainName}…` : 'Run a live trade'}
      </button>
      {state.msg && (
        <p className={`mt-2 text-[12.5px] ${state.ok === false ? 'text-[#B4532A]' : 'text-ink-mid'}`}>
          {state.msg}
          {state.hash && <> · <a href={explorer(getUnit(slug) ?? RWA_UNITS[0]).tx(state.hash)} target="_blank" rel="noreferrer" className="font-atx-mono text-peri-deep no-underline hover:underline">{shortHash(state.hash)} ↗</a></>}
        </p>
      )}
    </div>
  )
}

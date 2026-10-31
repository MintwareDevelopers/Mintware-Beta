'use client'

// V1 RWAs — the live market for one RWA liquidity unit. Every number is read from the chain via /api/rwa/unit
// (useRwaUnit, polled). The lifecycle proof + contracts live on /v1/rwas/proof. Light-only.

import { useState } from 'react'
import Link from 'next/link'
import { useSignMessage } from 'wagmi'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'
import { getUnit, explorer, shortHash, walletLabel, RWA_UNITS } from '@/lib/rwa/demo'
import { useRwaUnit, usd, ago, rwaStatus, STATUS_CLS } from './useRwaUnit'
import { BandGauge, LiquidityMap, PriceBandChart, LiveDot, Disclosure, ChainTabs, IconTile, IconParcel, IconBand, IconTrades, IconChainLink, EY, H2 } from './RwaVisuals'

const WRAP = 'max-w-[1160px] mx-auto px-8 max-[900px]:px-5'

// One market, read top to bottom: what it is → where the price sits against its appraisal → where the
// liquidity is → how the price has moved → what has traded → the proof behind all of it.
export function RwaMarket({ slug }: { slug: string }) {
  const u = getUnit(slug) ?? RWA_UNITS[0]
  const D = u.demo
  const ex = explorer(u)
  const { unit, failed, now, interest, reload } = useRwaUnit(u.slug)
  const status = rwaStatus(unit)
  const p = D.property
  const refused = D.legs.flatMap((l) => l.txs).filter((t) => t.status === 'reverted').length

  return (
    <div className="text-ink">
      {/* HEADER — what this market is */}
      <section className="bg-[radial-gradient(1000px_380px_at_90%_-20%,rgba(201,192,244,0.5),transparent_60%)]" style={{ borderBottom: '1px solid var(--mw-line)' }}>
        <div className={`${WRAP} pt-9 pb-9`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/v1/rwas" className="text-[13.5px] font-semibold text-ink-mid no-underline hover:text-ink">← Real-world assets</Link>
            <ChainTabs units={RWA_UNITS} active={u.slug} href={(s) => `/v1/rwas/${s}`} />
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <span className="w-14 h-14 rounded-[16px] grid place-items-center" style={{ background: 'linear-gradient(160deg,#EAF4E4,#B9D9A6)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8), var(--mw-raise-sm)', color: '#15151D' }}><IconParcel size={26} /></span>
            <div className="min-w-0">
              <h1 className="m-0 font-geist text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.04] tracking-[-0.04em]">{p.name.replace(' (demo)', '')}</h1>
              <p className="mt-1.5 mb-0 text-[14px] text-ink-mid"><span className="font-geist-mono">{p.symbol} / dUSD</span> · Uniswap v4{D.poolManagerDeployedByUs ? ' (our v4-core deployment)' : ''} · {u.chain.name}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <span className="rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: 'var(--mw-band)', color: 'var(--mw-ink-2)' }}>Testnet · unaudited · fictional property</span>
            {status && <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${STATUS_CLS[status.tone]}`}>{status.t}</span>}
            <LiveDot block={unit?.block} failed={failed} />
          </div>
        </div>
      </section>

      {/* 1 + 2 — the price against its appraisal, and where the liquidity sits */}
      <section>
        <div className={`${WRAP} py-10 grid grid-cols-[1.25fr_1fr] gap-5 max-[980px]:grid-cols-1`}>
          <div className="rounded-[26px] mw-raise-lg p-7 max-[640px]:p-5">
            <div className="flex items-center gap-3"><IconTile><IconBand /></IconTile><div className={EY}>Price per {p.symbol}</div></div>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <div className="font-geist-mono text-[clamp(40px,6vw,54px)] leading-none tracking-[-0.04em]">{unit ? usd(unit.spot.usd, 2) : '—'}</div>
              <div className="rounded-[14px] px-4 py-2.5 text-right" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                <div className="text-[12px] text-ink-soft">Appraisal{unit && <> · {ago(now - unit.appraisal.at)}</>}</div>
                <div className="font-geist-mono text-[18px] text-peri-deep">{unit ? usd(unit.appraisal.usd, 2) : '—'}</div>
              </div>
            </div>
            <div className="mt-8">{unit ? <BandGauge unit={unit} demo={D} /> : <div className="h-[110px] mw-shimmer rounded-[14px]" />}</div>
            {u.liveTrade
              ? <LiveTradeButton slug={u.slug} chainName={u.chain.name} onTraded={() => { reload(true); setTimeout(() => reload(true), 4000) }} />
              : <p className="mt-6 mb-0 pt-5 text-[13px] text-ink-soft" style={{ borderTop: '1px solid var(--mw-line)' }}>Live demo trading runs on the Base Sepolia market.</p>}
          </div>
          <div className="rounded-[26px] mw-raise p-7 max-[640px]:p-5">
            <div className={EY}>Where the liquidity sits</div>
            <p className="mt-2 mb-0 text-[14px] leading-[1.55] text-ink-mid">Open liquidity is split between the pool and a lending market, with the issuer’s own inventory underneath as first loss.</p>
            <div className="mt-6">{unit ? <LiquidityMap unit={unit} interest={interest} symbol={p.symbol} /> : <div className="h-[180px] mw-shimmer rounded-[14px]" />}</div>
          </div>
        </div>
      </section>

      {/* 3 — how the price has moved */}
      <section style={{ background: '#fff', borderTop: '1px solid var(--mw-line)', borderBottom: '1px solid var(--mw-line)' }}>
        <div className={`${WRAP} py-12`}>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-[620px]">
              <div className={EY}>Price vs appraisal</div>
              <h2 className={`${H2} mt-2`}>Trading stays anchored to the appraised value.</h2>
            </div>
            <p className="m-0 max-w-[400px] text-[15px] leading-[1.55] text-ink-mid">The pool’s hook refuses any swap that would end outside the hard band, unless it moves the price back toward the appraisal.</p>
          </div>
          <div className="mt-7 rounded-[24px] p-5 max-[640px]:p-3" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
            <div className="rounded-[18px] mw-raise p-4">{unit ? <PriceBandChart unit={unit} demo={D} /> : <div className="h-[280px] mw-shimmer rounded-[12px]" />}</div>
          </div>
        </div>
      </section>

      {/* 4 — what has traded */}
      <section>
        <div className={`${WRAP} py-12`}>
          <div className="flex items-center gap-3"><IconTile><IconTrades /></IconTile><div className={EY}>Trades</div></div>
          <h2 className={`${H2} mt-3`}>Settled on-chain{unit ? <span className="text-ink-soft"> · <span className="font-geist-mono">{unit.tradeCount}</span></span> : ''}</h2>
          <div className="mt-6 overflow-x-auto rounded-[22px] mw-raise">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-[0.08em] text-ink-soft" style={{ background: 'var(--mw-ground)' }}>
                  <th className="px-5 py-3 font-semibold">When</th><th className="px-5 py-3 font-semibold">Trader</th>
                  <th className="px-5 py-3 font-semibold">Side</th><th className="px-5 py-3 text-right font-semibold">{p.symbol}</th>
                  <th className="px-5 py-3 text-right font-semibold">dUSD</th><th className="px-5 py-3 text-right font-semibold">Price</th>
                  <th className="px-5 py-3 text-right font-semibold">Tx</th>
                </tr>
              </thead>
              <tbody>
                {unit?.trades.length ? unit.trades.map((t) => (
                  <tr key={t.tx} className="hover:bg-[#F6F6FA]" style={{ borderTop: '1px solid var(--mw-line)' }}>
                    <td className="px-5 py-3 text-ink-mid">{t.ts ? ago(now - t.ts) : <>block <span className="font-geist-mono">{t.block}</span></>}</td>
                    <td className="px-5 py-3">{t.trader ? walletLabel(t.trader, D) : '—'}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${t.side === 'buy' ? 'text-[#0F7A43] bg-[#E3F4EA]' : 'text-peri-deep bg-[#EDE9FB]'}`}>{t.side}</span></td>
                    <td className="px-5 py-3 text-right font-geist-mono">{t.units.toFixed(3)}</td>
                    <td className="px-5 py-3 text-right font-geist-mono">{t.usd.toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-geist-mono">{usd(t.priceUsd, 2)}</td>
                    <td className="px-5 py-3 text-right"><a href={ex.tx(t.tx)} target="_blank" rel="noreferrer" className="font-geist-mono text-[12.5px] text-peri-deep no-underline hover:underline">{shortHash(t.tx)} ↗</a></td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-ink-soft">{unit ? 'No trades yet.' : 'Reading the pool…'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 5 — the proof behind it */}
      <section className="pb-12">
        <div className={WRAP}>
          <Link href={`/v1/rwas/proof?unit=${u.slug}`} className="mw-raise mw-lift relative overflow-hidden rounded-[26px] p-7 max-[640px]:p-5 flex flex-wrap items-center justify-between gap-5 no-underline text-ink">
            <div aria-hidden="true" className="absolute -right-24 -top-28 w-72 h-72 rounded-full opacity-25 blur-[50px]" style={{ background: 'var(--mw-sheen)' }} />
            <div className="relative flex items-center gap-4">
              <IconTile><IconChainLink /></IconTile>
              <div>
                <div className="font-semibold text-[19px] tracking-[-0.02em]">The proof behind this market</div>
                <div className="text-[14px] text-ink-mid mt-0.5">Every lifecycle step as a transaction you can open, the <span className="font-geist-mono">{refused}</span> the chain refused, and the verified contracts.</div>
              </div>
            </div>
            <span className="relative mw-btn">See the proof →</span>
          </Link>
          <div className="mt-6"><Disclosure chainName={u.chain.name} symbol={p.symbol} /></div>
        </div>
      </section>
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
    <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--mw-line)' }}>
      <button onClick={run} disabled={state.busy} className="mw-btn w-full !min-h-[48px] disabled:opacity-60">
        {state.busy ? `Settling on ${chainName}…` : 'Run a live trade'}
      </button>
      {state.msg && (
        <p className={`mt-2 text-[12.5px] ${state.ok === false ? 'text-[#9A3F1C]' : 'text-ink-mid'}`}>
          {state.msg}
          {state.hash && <> · <a href={explorer(getUnit(slug) ?? RWA_UNITS[0]).tx(state.hash)} target="_blank" rel="noreferrer" className="font-geist-mono text-peri-deep no-underline hover:underline">{shortHash(state.hash)} ↗</a></>}
        </p>
      )}
    </div>
  )
}

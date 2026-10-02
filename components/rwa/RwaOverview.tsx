'use client'

// /app/rwa — the RWA workspace front door. Leads with the live Base market as ONE instrument (price inside the
// appraisal band + where the liquidity sits), then the chain's own refusals as the headline proof. Light-only.

import Link from 'next/link'
import { RWA_UNITS, explorer, shortHash } from '@/lib/rwa/demo'
import { useRwaUnit, usd, ago, rwaStatus, STATUS_CLS } from './useRwaUnit'
import { BandGauge, LiquidityMap, RefusalCards, LiveDot, Disclosure, EY, H2 } from './RwaVisuals'

const WRAP = 'max-w-[1160px] mx-auto px-8 max-[900px]:px-5'

export function RwaOverview() {
  const base = RWA_UNITS[0]
  const D = base.demo
  const { unit, failed, now, interest } = useRwaUnit(base.slug)
  const status = rwaStatus(unit)
  const proofTxs = RWA_UNITS.reduce((n, u) => n + u.demo.deployTxs.length + u.demo.legs.reduce((m, l) => m + l.txs.length, 0), 0)
  const refusedCount = RWA_UNITS.reduce((n, u) => n + u.demo.legs.flatMap((l) => l.txs).filter((t) => t.status === 'reverted').length, 0)

  return (
    <div className="text-ink">
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-hair-soft bg-[radial-gradient(1200px_420px_at_85%_-10%,rgba(108,108,240,0.14),transparent_60%),radial-gradient(900px_380px_at_0%_0%,rgba(42,158,138,0.10),transparent_55%)]">
        <div className={`${WRAP} pt-12 pb-10`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-hair bg-white/80 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[#1F7A6A]">V2 · RWA liquidity</span>
            <LiveDot block={unit?.block} failed={failed} label={`Live on ${base.chain.name}`} />
          </div>
          <h1 className="mt-5 max-w-[17ch] font-atx-display text-[clamp(2.4rem,5vw,4rem)] font-semibold leading-[1.0] tracking-[-0.04em]">
            The liquidity engine for regulated real-world assets.
          </h1>
          <p className="mt-5 max-w-[60ch] text-[16.5px] leading-[1.6] text-ink-mid">
            Tokenizing a property makes it divisible, not liquid. Mintware gives every asset its own market, anchored to
            its appraisal, open to any liquidity provider, while ownership stays with verified holders. Idle liquidity
            keeps earning until a trade needs it.
          </p>
          <div className="mt-8 grid grid-cols-4 gap-px overflow-hidden rounded-[18px] border border-hair bg-hair max-[820px]:grid-cols-2">
            <Stat k="Liquidity supplied" v={unit ? usd(unit.vault.seniorUsd) : '—'} />
            <Stat k="Earning while idle" v={unit ? `${Math.round((unit.lending.balanceUsd / Math.max(1, unit.lending.balanceUsd + unit.vault.deployedUsd)) * 100)}%` : '—'} />
            <Stat k="Proof transactions" v={String(proofTxs)} />
            <Stat k="Refused by the chain" v={String(refusedCount)} tone="warn" />
          </div>
        </div>
      </section>

      {/* LIVE INSTRUMENT */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-12`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className={EY}>Live market</div>
              <h2 className={`${H2} mt-1.5`}>{D.property.name.replace(' (demo)', '')}</h2>
              <p className="mt-1.5 text-[13.5px] text-ink-mid">{D.property.symbol} / dUSD · Uniswap v4 · {base.chain.name} · fictional land parcel</p>
            </div>
            <Link href={`/app/rwa/${base.slug}`} className="glass-pill-primary !px-5 no-underline">Open the market →</Link>
          </div>

          <div className="mt-7 grid grid-cols-[1.25fr_1fr] gap-5 max-[980px]:grid-cols-1">
            <div className="rounded-[24px] border border-hair bg-white p-7 shadow-[0_1px_2px_rgba(23,23,31,0.04),0_18px_48px_-24px_rgba(59,58,143,0.25)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className={EY}>Pool price</div>
                  <div className="mt-2 font-atx-display text-[52px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{unit ? usd(unit.spot.usd, 2) : '—'}</div>
                  <div className="mt-2 text-[13px] text-ink-mid">
                    vs appraisal <span className="font-semibold text-peri-deep">{unit ? usd(unit.appraisal.usd, 2) : '—'}</span>
                    {unit && <> · appraised {ago(now - unit.appraisal.at)}</>}
                  </div>
                </div>
                {status && <span className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${STATUS_CLS[status.tone]}`}>{status.t}</span>}
              </div>
              <div className="mt-8">{unit ? <BandGauge unit={unit} demo={D} /> : <div className="h-[110px] mw-shimmer rounded-[14px]" />}</div>
              <p className="mt-5 border-t border-hair-soft pt-4 text-[12.5px] leading-[1.55] text-ink-soft">
                A swap that would end outside the hard band is refused by the pool&apos;s hook, unless it moves the price back
                toward the appraisal. The issuer cannot move the appraisal faster than a capped step and a daily drift limit.
              </p>
            </div>

            <div className="rounded-[24px] border border-hair bg-white p-7">
              <div className={EY}>Where the liquidity sits</div>
              <h3 className="mt-1.5 font-atx-display text-[19px] font-semibold tracking-[-0.01em]">Never idle, never in the way</h3>
              <div className="mt-6">{unit ? <LiquidityMap unit={unit} interest={interest} symbol={D.property.symbol} /> : <div className="h-[180px] mw-shimmer rounded-[14px]" />}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ENFORCED BY THE CHAIN */}
      <section className="border-b border-hair-soft bg-[#FCFBFF]">
        <div className={`${WRAP} py-12`}>
          <div className={EY}>Enforced by the chain, not by a policy document</div>
          <h2 className={`${H2} mt-1.5 max-w-[30ch]`}>We asked the contracts to break the rules. They refused.</h2>
          <p className="mt-2 max-w-[66ch] text-[14px] leading-[1.6] text-ink-mid">
            Both of these were real transactions, mined and reverted on {base.chain.name}, with the exact rule decoded from the chain.
          </p>
          <div className="mt-7"><RefusalCards unit={base} /></div>
          <Link href="/app/rwa/proof" className="mt-6 inline-flex text-[13.5px] font-semibold text-peri-deep no-underline hover:underline">See the full lifecycle, every transaction →</Link>
        </div>
      </section>

      {/* THREE ROLES */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-12`}>
          <div className={EY}>How it clears</div>
          <h2 className={`${H2} mt-1.5`}>Permissionless liquidity. Compliant ownership.</h2>
          <div className="mt-8 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-3 max-[900px]:grid-cols-1">
            <RoleCard n="01" tag="Open to anyone" title="Liquidity providers" body="Supply dollars to the senior tranche. They never hold the property token, so its transfer rules never reach them, and they exit in dollars." tone="teal" />
            <Arrow />
            <RoleCard n="02" tag="Enrolled once" title="Vault + pool" body="The vault puts a slice into a standard Uniswap v4 pool and lends the rest. The issuer's own inventory sits underneath as first-loss." tone="peri" />
            <Arrow />
            <RoleCard n="03" tag="Verified" title="Traders" body="Checked by the issuer's token at the moment they receive it. An unverified wallet is refused by the token itself." tone="coral" />
          </div>
        </div>
      </section>

      {/* CHAINS */}
      <section className="border-b border-hair-soft bg-[#FAFAFD]">
        <div className={`${WRAP} py-12`}>
          <div className={EY}>One liquidity unit, any EVM chain</div>
          <h2 className={`${H2} mt-1.5`}>Live on {RWA_UNITS.length} chains</h2>
          <div className="mt-7 grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
            {RWA_UNITS.map((u) => {
              const first = u.demo.deployTxs[0]?.hash ?? ''
              const n = u.demo.deployTxs.length + u.demo.legs.reduce((m, l) => m + l.txs.length, 0)
              return (
                <Link key={u.slug} href={`/app/rwa/${u.slug}`} className="group rounded-[20px] border border-hair bg-white p-6 no-underline transition-shadow hover:shadow-[0_14px_40px_-22px_rgba(59,58,143,0.45)]">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-ink-mid"><span className="h-2 w-2 rounded-full bg-mw-live" />{u.chain.name}</span>
                    <span className="text-[12px] text-ink-soft">{n} transactions</span>
                  </div>
                  <div className="mt-3 font-atx-display text-[20px] font-semibold text-ink">{u.demo.property.name.replace(' (demo)', '')}</div>
                  <div className="mt-1 text-[13px] text-ink-mid">
                    {u.demo.poolManagerDeployedByUs ? 'Our own v4-core deployment — no Uniswap v4 on this chain yet' : 'Canonical Uniswap v4'} · gas in {u.chain.nativeSymbol}
                  </div>
                  <div className="mt-5 flex items-center justify-between text-[12.5px]">
                    <span className="font-atx-mono text-ink-soft" title={explorer(u).tx(first)}>first tx {shortHash(first)}</span>
                    <span className="font-semibold text-peri-deep group-hover:underline">Open market →</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      <section><div className={`${WRAP} py-8`}><Disclosure chainName={base.chain.name} symbol={D.property.symbol} /></div></section>
    </div>
  )
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'warn' }) {
  return (
    <div className="bg-white/90 px-5 py-4">
      <div className="text-[11.5px] text-ink-soft">{k}</div>
      <div className={`mt-1 font-atx-display text-[26px] font-semibold tracking-[-0.02em] tabular-nums ${tone === 'warn' ? 'text-[#B4532A]' : 'text-ink'}`}>{v}</div>
    </div>
  )
}

const TONES = {
  teal: 'text-[#1F7A6A] bg-[rgba(42,158,138,0.10)]',
  peri: 'text-peri-deep bg-[rgba(108,108,240,0.10)]',
  coral: 'text-[#B4532A] bg-[rgba(232,138,103,0.14)]',
}
function RoleCard({ n, tag, title, body, tone }: { n: string; tag: string; title: string; body: string; tone: keyof typeof TONES }) {
  return (
    <div className="rounded-[20px] border border-hair bg-white p-6">
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] ${TONES[tone]}`}>{tag}</span>
        <span className="font-atx-mono text-[12px] text-ink-soft">{n}</span>
      </div>
      <h3 className="mt-4 font-atx-display text-[18px] font-semibold">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-mid">{body}</p>
    </div>
  )
}
function Arrow() {
  return <div className="grid place-items-center text-[20px] text-ink-soft max-[900px]:rotate-90 max-[900px]:py-1" aria-hidden>→</div>
}

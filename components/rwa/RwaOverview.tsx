'use client'

// /app/rwas — the owned RWA engine, its holdings and permission/appraisal rules. Light-only.

import Link from 'next/link'
import { RWA_UNITS } from '@/lib/rwa/units'
import { useRwaUnit, ago, rwaStatus, STATUS_CLS } from './useRwaUnit'
import { BandGauge, LiquidityMap, LiveDot, ReadState, amount, observedDate, IconTile, IconRefused, Disclosure, EY, H2 } from './RwaVisuals'

const WRAP = 'max-w-[1160px] mx-auto px-8 max-[900px]:px-5 max-[640px]:px-3'

export function RwaOverview() {
  const base = RWA_UNITS[0]
  const { unit, failed, now } = useRwaUnit(base.slug)
  const status = rwaStatus(unit)
  const hook = unit?.hook

  return (
    <div className="text-ink">
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-hair-soft bg-[radial-gradient(1100px_440px_at_85%_-10%,rgba(201,192,244,0.55),transparent_60%),radial-gradient(800px_360px_at_0%_0%,rgba(242,203,194,0.35),transparent_55%)]">
        <div className={`${WRAP} pt-12 pb-10`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full mw-raise-sm px-3 py-1 text-[12px] font-semibold text-peri-deep">RWA liquidity · demo</span>
            {unit?.source !== 'undeployed' && <LiveDot block={unit?.block} failed={failed} label={base.chainName} />}
          </div>
          <h1 className="mt-5 max-w-[17ch] font-atx-display text-[clamp(2.4rem,5vw,4rem)] font-semibold leading-[1.0] tracking-[-0.04em]">
            The liquidity engine for regulated real-world assets.
          </h1>
          <p className="mt-5 max-w-[60ch] text-[16.5px] leading-[1.6] text-ink-mid">
            Tokenizing a property makes it divisible, not liquid. Mintware gives every asset its own market, anchored to
            a dated appraisal. Qualified holders contribute property tokens and USDC for one non-transferable share
            class. The engine owns the pool position and keeps remaining assets in idle adapters.
          </p>
          <div className="mt-8 grid grid-cols-4 gap-px overflow-hidden rounded-[18px] mw-raise-sm bg-hair max-[820px]:grid-cols-2">
            <Stat k={unit?.source === 'cached' ? 'NAV at snapshot (USDC)' : 'Engine NAV (USDC)'} v={amount(unit?.engine?.nav, 6)} />
            <Stat k="Share supply" v={amount(unit?.engine?.supply, 18)} />
            <Stat k="Core band (ticks)" v={hook ? `±${hook.coreBandTicks}` : '—'} />
            <Stat k="Outer band (ticks)" v={hook ? `±${hook.specBandTicks}` : '—'} />
          </div>
          <div className="mt-5"><ReadState unit={unit} failed={failed} /></div>
        </div>
      </section>

      {/* LIVE INSTRUMENT */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-12`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className={EY}>Owned market</div>
              <h2 className={`${H2} mt-1.5`}>{base.name}</h2>
              <p className="mt-1.5 text-[13.5px] text-ink-mid">{base.symbol} / USDC · Uniswap v4 · {base.chainName} · fictional land parcel</p>
            </div>
            <Link href={`/app/rwas/${base.slug}`} className="mw-btn">Open the market →</Link>
          </div>

          <div className="mt-7 grid grid-cols-[1.25fr_1fr] gap-5 max-[980px]:grid-cols-1">
            <div className="rounded-[24px] mw-raise-lg p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className={EY}>Appraisal (USDC per unit)</div>
                  <div className="mt-2 font-geist-mono text-[clamp(40px,6vw,52px)] leading-none tracking-[-0.04em] break-words">{amount(hook?.priceWad, 18)}</div>
                  <div className="mt-2 text-[13px] text-ink-mid">
                    {hook ? <><time dateTime={new Date(hook.observedAt * 1000).toISOString()}>{observedDate(hook.observedAt)}</time> · {ago(now - hook.observedAt)}</> : 'Awaiting a dated appraisal.'}
                  </div>
                </div>
                {status && <span className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${STATUS_CLS[status.tone]}`}>{status.t}</span>}
              </div>
              <div className="mt-8">{unit ? <BandGauge unit={unit} /> : <div className="h-[110px] bg-[var(--mw-ground)] rounded-[14px]" />}</div>
              <p className="mt-5 border-t border-hair-soft pt-4 text-[12.5px] leading-[1.55] text-ink-soft">
                A swap that would end outside the hard band is refused by the pool&apos;s hook, unless it moves the price back
                toward the appraisal. The issuer cannot move the appraisal faster than a capped step and a daily drift limit.
              </p>
            </div>

            <div className="rounded-[24px] mw-raise p-7">
              <div className={EY}>Where the liquidity sits</div>
              <h3 className="mt-1.5 font-atx-display text-[19px] font-semibold tracking-[-0.01em]">One position. One share class.</h3>
              <div className="mt-6">{unit ? <LiquidityMap unit={unit} symbol={base.symbol} /> : <div className="h-[180px] bg-[var(--mw-ground)] rounded-[14px]" />}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ENFORCED BY THE CHAIN */}
      <section className="border-b border-hair-soft bg-[#F6F6FA]">
        <div className={`${WRAP} py-12`}>
          <div className={EY}>Rules enforced by the hook</div>
          <h2 className={`${H2} mt-1.5 max-w-[30ch]`}>Permissions and appraisal travel with the pool.</h2>
          <p className="mt-2 max-w-[66ch] text-[14px] leading-[1.6] text-ink-mid">The engine and hook check new activity on-chain. Full in-kind exits need no appraisal; issuer transfer restrictions still apply.</p>
          <div className="mt-7 grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
            {[
              ['Issuer permissions', 'Each trader needs swap permission. New shares require holder and engine liquidity permission, plus engine wrapper approval.'],
              ['Dated appraisal', 'Stale observations and guardian pauses stop new trades. A permitted trade outside the band must narrow the gap without crossing the opposite boundary.'],
            ].map(([title, body]) => <div key={title} className="mw-raise rounded-[22px] p-6" style={{ outline: '1.5px solid rgba(201,87,43,.28)', outlineOffset: -1.5 }}>
              <IconTile tone="coral"><IconRefused /></IconTile>
              <h3 className="mt-4 text-[19px] font-semibold tracking-[-0.02em]">{title}</h3>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-ink-mid">{body}</p>
            </div>)}
          </div>
          <Link href="/app/rwas/proof" className="mt-6 inline-flex text-[13.5px] font-semibold text-peri-deep no-underline hover:underline">View archived transactions from the previous model →</Link>
        </div>
      </section>

      {/* THREE ROLES */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-12`}>
          <div className={EY}>How it clears</div>
          <h2 className={`${H2} mt-1.5`}>Qualified holders. Proportional ownership.</h2>
          <div className="mt-8 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-3 max-[900px]:grid-cols-1">
            <RoleCard n="01" tag="Issuer permission" title="Liquidity providers" body="Contribute property tokens and USDC. One non-transferable share class tracks proportional holdings, with exits paid in kind." tone="teal" />
            <Arrow />
            <RoleCard n="02" tag="Enrolled once" title="Engine + pool" body="The engine owns a direct Uniswap v4 position and holds idle assets through adapters. The hook checks permissions and the appraisal band." tone="peri" />
            <Arrow />
            <RoleCard n="03" tag="Verified" title="Traders" body="Trades use the permissioned router. The hook checks trader permission and the property token enforces its own recipient restrictions." tone="coral" />
          </div>
        </div>
      </section>

      <section><div className={`${WRAP} py-8`}><Disclosure chainName={base.chainName} symbol={base.symbol} /></div></section>
    </div>
  )
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'warn' }) {
  return (
    <div className="bg-white px-5 py-4">
      <div className="text-[12px] text-ink-soft">{k}</div>
      <div className={`mt-1 font-geist-mono text-[26px] tracking-[-0.03em] ${tone === 'warn' ? 'text-[#9A3F1C]' : 'text-ink'}`}>{v}</div>
    </div>
  )
}

const TONES = {
  teal: 'text-[#0F7A43] bg-[#E3F4EA]',
  peri: 'text-peri-deep bg-[#EDE9FB]',
  coral: 'text-[#9A3F1C] bg-[#FBEEE7]',
}
function RoleCard({ n, tag, title, body, tone }: { n: string; tag: string; title: string; body: string; tone: keyof typeof TONES }) {
  return (
    <div className="rounded-[20px] mw-raise p-6">
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${TONES[tone]}`}>{tag}</span>
        <span className="font-geist-mono text-[12px] text-ink-soft">{n}</span>
      </div>
      <h3 className="mt-4 text-[19px] font-semibold tracking-[-0.02em]">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-mid">{body}</p>
    </div>
  )
}
function Arrow() {
  return <div className="grid place-items-center text-ink-soft max-[900px]:rotate-90 max-[900px]:py-1" aria-hidden><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
}

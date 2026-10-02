import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import { MwNav } from '@/components/web2/MwNav'
import { V2_COOKIE } from '@/lib/v2/gate'
import { isV2RwaVisible, canSeeRwa } from '@/lib/v2/rwaGate'
import { RwaAccess } from '@/components/rwa/RwaAccess'
import { RWA_UNITS, explorer, shortHash } from '@/lib/rwa/demo'

// /app/rwa — V2-RWAs overview: the liquidity engine for tokenized real-world assets, and the live demo unit on
// every chain it runs on (Base Sepolia, XRPL EVM testnet). SERVER-gated (404 unless the V2-RWAs flag is on and the
// visitor passes the V2 gate). Testnet + unaudited.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'RWA liquidity · Mintware', robots: { index: false, follow: false } }

const WRAP = 'max-w-[1120px] mx-auto px-6 max-sm:px-4'

export default async function RwaHome({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const jar = await cookies()
  if (!isV2RwaVisible(jar.get(V2_COOKIE)?.value)) notFound()
  if (!canSeeRwa(jar)) {
    return (
      <>
        <MwNav />
        <RwaAccess next={(await searchParams).next} />
      </>
    )
  }

  return (
    <>
      <MwNav />
      <main className="min-h-screen bg-white text-ink">
        <section className="border-b border-hair-soft bg-[linear-gradient(180deg,#F6F6FC_0%,#FFFFFF_100%)]">
          <div className={`${WRAP} pb-12 pt-14`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-peri-deep">V2 · RWA liquidity</div>
            <h1 className="mt-3 max-w-[18ch] font-atx-display text-[clamp(2.2rem,4.6vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
              Liquid markets for real-world assets.
            </h1>
            <p className="mt-4 max-w-[62ch] text-[16px] leading-[1.6] text-ink-mid">
              Tokenizing a property makes it divisible, not liquid. Mintware is the liquidity engine underneath: a
              compliant market per asset, anchored to its appraisal, where idle liquidity keeps earning until a trade needs it.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5 text-[12.5px]">
              {['Permissionless liquidity', 'Compliant ownership', 'Appraisal-anchored', 'Idle liquidity earns', `Live on ${RWA_UNITS.length} chains`].map((t) => (
                <span key={t} className="rounded-full border border-hair bg-white px-3 py-1.5 font-semibold text-ink-mid">{t}</span>
              ))}
            </div>
          </div>
        </section>

        <section className={`${WRAP} py-12`}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">The same liquidity unit, live on every chain it runs on</div>
          <div className="mt-4 grid gap-5">
            {RWA_UNITS.map((u) => {
              const d = u.demo
              const proofCount = d.legs.reduce((n, l) => n + l.txs.length, 0)
              const refused = d.legs.flatMap((l) => l.txs).filter((t) => t.status === 'reverted')
              const first = d.deployTxs[0]?.hash ?? ''
              return (
                <div key={u.slug}>
                  <Link href={`/app/rwa/${u.slug}`} className="soft-card block p-7 no-underline">
                    <div className="flex flex-wrap items-start justify-between gap-6">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mw-live opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-mw-live" /></span>
                          <span className="text-[12px] font-semibold text-ink-mid">Live on {u.chain.name} · testnet demo · fictional property</span>
                        </div>
                        <h2 className="mt-2 font-atx-display text-[26px] font-semibold tracking-[-0.02em] text-ink">{d.property.name.replace(' (demo)', '')}</h2>
                        <p className="mt-1.5 text-[14px] text-ink-mid">
                          {d.property.symbol} / dUSD · Uniswap v4{d.poolManagerDeployedByUs ? ' (our v4-core deployment — no Uniswap v4 on this chain yet)' : ''} · appraisal-banded · gas in {u.chain.nativeSymbol}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="font-atx-display text-[30px] font-semibold text-ink">{proofCount}</div>
                        <div className="text-[12.5px] text-ink-mid">proof transactions, {refused.length} refused on-chain</div>
                      </div>
                    </div>
                    <div className="mt-6 grid grid-cols-3 gap-3 text-[13px] max-[700px]:grid-cols-1">
                      {refused.map((t) => (
                        <div key={t.hash} className="rounded-[14px] border border-[rgba(232,138,103,0.4)] bg-[#FFF8F4] px-4 py-3">
                          <div className="font-semibold text-[#B4532A]">Refused{t.reason ? ` · ${t.reason.error}` : ''}</div>
                          <div className="mt-0.5 text-ink-mid">{t.label}</div>
                        </div>
                      ))}
                      <div className="rounded-[14px] border border-hair bg-white px-4 py-3">
                        <div className="font-semibold text-peri-deep">Open the market →</div>
                        <div className="mt-0.5 text-ink-mid">Live price, band, trades, proof</div>
                      </div>
                    </div>
                  </Link>
                  <p className="mt-2.5 px-1 text-[12.5px] text-ink-soft">
                    First deploy tx on {u.chain.name}:{' '}
                    <a href={explorer(u).tx(first)} target="_blank" rel="noreferrer" className="font-atx-mono text-peri-deep no-underline hover:underline">{shortHash(first)}</a>
                  </p>
                </div>
              )
            })}
          </div>
          <p className="mt-6 text-[12.5px] text-ink-soft">Every contract is source-verified. Valueless test tokens, simulated lending yield, unaudited.</p>
        </section>
      </main>
    </>
  )
}

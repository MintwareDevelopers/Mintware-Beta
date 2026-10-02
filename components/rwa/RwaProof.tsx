'use client'

// /app/rwa/proof — the recorded lifecycle run as a timeline (every step a transaction you can open), the two
// on-chain refusals, and the source-verified contract set. Per chain (?unit=).

import Link from 'next/link'
import { getUnit, explorer, contractRows, revertReasonText, shortHash, RWA_UNITS } from '@/lib/rwa/demo'
import { RefusalCards, Disclosure, EY, H2 } from './RwaVisuals'

const WRAP = 'max-w-[1160px] mx-auto px-8 max-[900px]:px-5'
const displayLabel = (l: string) => l.replace(' deposits ', ' supplies ')

export function RwaProof({ slug }: { slug: string }) {
  const u = getUnit(slug) ?? RWA_UNITS[0]
  const D = u.demo
  const ex = explorer(u)
  const xrpl = u.network === 'xrpl-evm-testnet'
  const txCount = D.deployTxs.length + D.legs.reduce((n, l) => n + l.txs.length, 0)

  return (
    <div className="text-ink">
      <section className="border-b border-hair-soft bg-[radial-gradient(1000px_360px_at_90%_-20%,rgba(42,158,138,0.10),transparent_60%)]">
        <div className={`${WRAP} pt-9 pb-8`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className={EY}>On-chain proof</div>
            <div className="inline-flex rounded-full border border-hair bg-white p-1" role="tablist" aria-label="Chain">
              {RWA_UNITS.map((x) => (
                <Link key={x.slug} href={`/app/rwa/proof?unit=${x.slug}`} role="tab" aria-selected={x.slug === u.slug}
                  className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold no-underline transition-colors ${x.slug === u.slug ? 'bg-[rgba(108,108,240,0.12)] text-peri-deep' : 'text-ink-mid hover:text-ink'}`}>
                  {x.chain.name}
                </Link>
              ))}
            </div>
          </div>
          <h1 className="mt-4 max-w-[24ch] font-atx-display text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em]">Every step, a transaction you can open.</h1>
          <p className="mt-3 max-w-[66ch] text-[15px] leading-[1.6] text-ink-mid">
            The full lifecycle of {D.property.name.replace(' (demo)', '')}, run on {u.chain.name} on{' '}
            {new Date(D.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}: {txCount} transactions, from deploy to an LP exit.
          </p>
        </div>
      </section>

      <section className="border-b border-hair-soft bg-[#FCFBFF]">
        <div className={`${WRAP} py-10`}>
          <h2 className={H2}>The two refusals</h2>
          <div className="mt-6"><RefusalCards unit={u} /></div>
        </div>
      </section>

      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-10`}>
          <h2 className={H2}>The lifecycle</h2>
          <ol className="relative mt-8 ml-3.5 border-l border-hair">
            {D.legs.map((leg) => {
              const refused = leg.txs.some((t) => t.status === 'reverted')
              return (
                <li key={leg.n} className="relative pb-8 pl-8 last:pb-0">
                  <span className={`absolute -left-[15px] top-0 grid h-[30px] w-[30px] place-items-center rounded-full border-4 border-white text-[12px] font-bold ${refused ? 'bg-[#F7D9CC] text-[#B4532A]' : 'bg-[#E2E1FB] text-peri-deep'}`}>{leg.n}</span>
                  <div className={`rounded-[18px] border p-5 ${refused ? 'border-[rgba(232,138,103,0.45)] bg-[#FFF8F4]' : 'border-hair bg-white'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[15.5px]">{leg.title}</h3>
                      {refused && <span className="rounded-full bg-[rgba(232,138,103,0.18)] px-2 py-0.5 text-[11.5px] font-semibold text-[#B4532A]">Refused on-chain</span>}
                    </div>
                    <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-mid">{leg.desc}</p>
                    <ul className="mt-3 grid gap-1.5">
                      {leg.txs.map((t) => (
                        <li key={t.hash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
                          <span className="text-ink">
                            <span className={t.status === 'reverted' ? 'text-[#B4532A]' : 'text-[#2F7D5B]'}>{t.status === 'reverted' ? '⨯' : '✓'}</span> {displayLabel(t.label)}
                            {revertReasonText(t) && <span className="block text-[12px] text-[#B4532A]">{revertReasonText(t)}</span>}
                          </span>
                          <a href={ex.tx(t.hash)} target="_blank" rel="noreferrer" className="font-atx-mono text-[12.5px] text-peri-deep no-underline hover:underline">{shortHash(t.hash)} ↗</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      <section className="border-b border-hair-soft bg-[#FAFAFD]">
        <div className={`${WRAP} py-10`}>
          <h2 className={H2}>{xrpl ? `Contracts on ${u.chain.name}, source proven by metadata hash` : `Contracts, source-verified on ${u.chain.name}`}</h2>
          {xrpl && (
            <p className="mt-2 max-w-[72ch] text-[13px] leading-[1.55] text-ink-mid">
              This chain&apos;s explorer verifier does not support Solidity 0.8.26 yet, so each contract is proven instead by its on-chain
              metadata hash matching the build from this repo&apos;s source (<span className="font-atx-mono">scripts/prove-rwa-source-match.mjs</span>, re-runnable by anyone).
              {D.poolManagerDeployedByUs && ' There is no Uniswap v4 on this chain yet, so the PoolManager is our own testnet deployment of v4-core.'}
            </p>
          )}
          <div className="mt-5 overflow-x-auto rounded-[22px] border border-hair bg-white">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <tbody>
                {contractRows(u).map((r) => (
                  <tr key={r.key} className="border-b border-hair-soft last:border-0">
                    <td className="px-5 py-3.5"><div className="font-semibold">{r.name}</div><div className="text-[12.5px] text-ink-mid">{r.role}</div></td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <a href={ex.addr(D.contracts[r.key])} target="_blank" rel="noreferrer" className="font-atx-mono text-[12.5px] text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.contracts[r.key])}</a>
                      <a href={ex.source(r.key, D.contracts[r.key])} target="_blank" rel="noreferrer" className="ml-3 rounded-full bg-[rgba(47,125,91,0.10)] px-2 py-0.5 text-[11.5px] font-semibold text-[#2F7D5B] no-underline">{xrpl ? 'Source match ✓' : 'Verified source ↗'}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section><div className={`${WRAP} py-8`}><Disclosure chainName={u.chain.name} symbol={D.property.symbol} /></div></section>
    </div>
  )
}

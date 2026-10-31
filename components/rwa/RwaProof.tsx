'use client'

// /v1/rwas/proof — the recorded lifecycle run as a timeline (every step a transaction you can open), the two
// on-chain refusals, and the source-verified contract set. Per chain (?unit=).

import Link from 'next/link'
import { getUnit, explorer, contractRows, revertReasonText, shortHash, RWA_UNITS } from '@/config/rwa-archive/proof'
import { Disclosure, ChainTabs, IconTile, IconChainLink, IconRefused, IconVerified, EY, H2 } from './RwaVisuals'

import { RefusalCards } from './RwaProofVisuals'

const WRAP = 'max-w-[1160px] mx-auto px-8 max-[900px]:px-5'
const displayLabel = (l: string) => l.replace(' deposits ', ' supplies ')

export function RwaProof({ slug }: { slug: string }) {
  const u = getUnit(slug) ?? RWA_UNITS[0]
  const D = u.demo
  const ex = explorer(u)
  const txCount = D.deployTxs.length + D.legs.reduce((n, l) => n + l.txs.length, 0)
  const refusedCount = D.legs.flatMap((l) => l.txs).filter((t) => t.status === 'reverted').length
  const contracts = contractRows(u)

  return (
    <div className="text-ink">
      {/* HEADER — what this page proves, in three numbers */}
      <section className="bg-[radial-gradient(1000px_380px_at_90%_-20%,rgba(201,192,244,0.5),transparent_60%)]" style={{ borderBottom: '1px solid var(--mw-line)' }}>
        <div className={`${WRAP} pt-9 pb-10`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={`/v1/rwas/${u.slug}`} className="text-[13.5px] font-semibold text-ink-mid no-underline hover:text-ink">← Back to the market</Link>
            <ChainTabs units={RWA_UNITS} active={u.slug} href={(s) => `/v1/rwas/proof?unit=${s}`} />
          </div>
          <div className={`${EY} mt-7`}>Archived proof · previous model</div>
          <h1 className="mt-2 max-w-[22ch] font-geist text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.04] tracking-[-0.04em]">Every step, a transaction you can open.</h1>
          <p className="mt-3 max-w-[66ch] text-[15.5px] leading-[1.6] text-ink-mid">
            The full lifecycle of {D.property.name.replace(' (demo)', '')}, a fictional parcel, run on {u.chain.name} on{' '}
            {new Date(D.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}, from deploy to an LP exit.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-[640px] max-[560px]:grid-cols-1">
            {([['Transactions', txCount, <IconChainLink key="c" />, 'peri'], ['Refused by the chain', refusedCount, <IconRefused key="r" />, 'coral'], ['Contracts, verified source', contracts.length, <IconVerified key="v" />, 'peri']] as const).map(([k, v, icon, tone]) => (
              <div key={k} className="mw-raise-sm rounded-[18px] p-4 flex items-center gap-3">
                <IconTile tone={tone}>{icon}</IconTile>
                <div><div className="font-geist-mono text-[24px] leading-none tracking-[-0.03em]">{v}</div><div className="text-[12.5px] text-ink-soft mt-1">{k}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 1 — the headline evidence */}
      <section>
        <div className={`${WRAP} py-12`}>
          <div className={EY}>The refusals</div>
          <h2 className={`${H2} mt-2`}>We asked the contracts to break the rules. They refused.</h2>
          <div className="mt-7"><RefusalCards unit={u} /></div>
        </div>
      </section>

      {/* 2 — the lifecycle */}
      <section style={{ background: '#fff', borderTop: '1px solid var(--mw-line)', borderBottom: '1px solid var(--mw-line)' }}>
        <div className={`${WRAP} py-12`}>
          <div className={EY}>The lifecycle</div>
          <h2 className={`${H2} mt-2`}>From deploy to an LP exit.</h2>
          <ol className="mt-9 p-0 list-none flex flex-col">
            {D.legs.map((leg, i) => {
              const refused = leg.txs.some((t) => t.status === 'reverted')
              return (
                <li key={leg.n} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-geist-mono text-[13px] font-semibold"
                      style={refused ? { background: '#FBEEE7', color: '#9A3F1C', boxShadow: '0 0 0 2px rgba(201,87,43,.3)' } : { background: 'var(--mw-btn)', color: '#fff', boxShadow: 'var(--mw-glow)' }}>{leg.n}</span>
                    {i < D.legs.length - 1 && <span className="w-px flex-1 my-1.5" style={{ background: 'var(--mw-line)' }} />}
                  </div>
                  <div className="flex-1 min-w-0 pb-6">
                    <div className="mw-raise rounded-[20px] p-5" style={refused ? { outline: '1.5px solid rgba(201,87,43,.28)', outlineOffset: -1.5 } : undefined}>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="m-0 font-semibold text-[16.5px] tracking-[-0.01em]">{leg.title}</h3>
                        {refused && <span className="rounded-full bg-[#FBEEE7] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#9A3F1C]">Refused on-chain</span>}
                      </div>
                      <p className="mt-1.5 mb-0 text-[14px] leading-[1.55] text-ink-mid">{leg.desc}</p>
                      <ul className="mt-4 p-0 list-none grid gap-1.5">
                        {leg.txs.map((t) => (
                          <li key={t.hash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[12px] px-3.5 py-2.5 text-[13.5px]" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                            <span className="min-w-0">
                              <span className={`font-semibold ${t.status === 'reverted' ? 'text-[#9A3F1C]' : 'text-[#0F7A43]'}`}>{t.status === 'reverted' ? '⨯' : '✓'}</span> {displayLabel(t.label)}
                              {revertReasonText(t) && <span className="block text-[12.5px] text-[#9A3F1C]">{revertReasonText(t)}</span>}
                            </span>
                            <a href={ex.tx(t.hash)} target="_blank" rel="noreferrer" className="font-geist-mono text-[12.5px] text-peri-deep no-underline hover:underline">{shortHash(t.hash)} ↗</a>
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

      {/* 3 — the contracts */}
      <section>
        <div className={`${WRAP} py-12`}>
          <div className={EY}>The contracts</div>
          <h2 className={`${H2} mt-2`}>Source-verified on {u.chain.name}.</h2>
          <div className="mt-7 rounded-[22px] mw-raise overflow-hidden">
            {contracts.map((r, i) => (
              <div key={r.key} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4" style={i ? { borderTop: '1px solid var(--mw-line)' } : undefined}>
                <div className="min-w-0 flex items-center gap-3">
                  <IconTile><IconVerified size={18} /></IconTile>
                  <div><div className="font-semibold">{r.name}</div><div className="text-[13px] text-ink-mid">{r.role}</div></div>
                </div>
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <a href={ex.addr(D.contracts[r.key])} target="_blank" rel="noreferrer" className="font-geist-mono text-[12.5px] text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.contracts[r.key])}</a>
                  <a href={ex.source(r.key, D.contracts[r.key])} target="_blank" rel="noreferrer" className="rounded-full bg-[#E3F4EA] px-2.5 py-1 text-[12px] font-semibold text-[#0F7A43] no-underline hover:underline">Verified source ↗</a>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8"><Disclosure chainName={u.chain.name} symbol={D.property.symbol} /></div>
        </div>
      </section>
    </div>
  )
}

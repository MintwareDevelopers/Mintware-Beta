'use client'

// Issuers lane — the issuer's side of the RWA vertical: each liquidity unit the org issues, read live from
// chain (backing inventory + lock, how much of the pool it covers, appraisal health). Read-only: appraisals are
// posted by the unit's keeper seat and listing a new asset is an operator-run deploy.

import Link from 'next/link'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { RWA_UNITS, explorer, shortHash, type RwaUnit } from '@/lib/rwa/demo'
import { useRwaUnit, usd, ago, rwaStatus, STATUS_CLS } from './useRwaUnit'

export function RwaIssuerConsole() {
  return (
    <div className="text-ink">
      <div className="grid gap-5">
        {RWA_UNITS.map((u) => <GradientPanel key={u.slug} tone="lavender" className="p-2.5"><UnitCard unit={u} /></GradientPanel>)}
      </div>
    </div>
  )
}

function UnitCard({ unit }: { unit: RwaUnit }) {
  const { unit: live, now } = useRwaUnit(unit.slug, 30_000)
  const ex = explorer(unit)
  const D = unit.demo
  const status = rwaStatus(live)
  // The recorded snapshot carries no issuer-side state (inventory, lock, buffer): only a chain read fills those.
  const chain = live && live.source !== 'recorded' ? live : null
  const lockDays = chain ? Math.max(0, Math.round((chain.vault.lockExpiry - now) / 86400)) : null
  const cover = chain && chain.vault.deployedUsd > 0 ? chain.vault.juniorUsd / chain.vault.deployedUsd : null
  const nextUpdate = live?.source === 'live' && live.appraisal.minUpdateSecs ? Math.max(0, live.appraisal.at + live.appraisal.minUpdateSecs - now) : null
  const ageLeft = live?.source === 'live' && live.appraisal.maxAgeSecs ? live.appraisal.at + live.appraisal.maxAgeSecs - now : null

  return (
    <div className="rounded-[22px] p-6 max-[640px]:p-4 mw-raise">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[12px] text-ink-mid"><span className="h-2 w-2 rounded-full bg-mw-live" />{unit.chain.name} · {D.property.symbol}</div>
          <div className="mt-1 text-[21px] font-semibold tracking-[-0.025em]">{D.property.name.replace(' (demo)', '')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status && <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${STATUS_CLS[status.tone]}`}>{status.t}</span>}
          <Link href={`/app/rwas/${unit.slug}`} className="mw-btn-quiet !min-h-[40px] no-underline">Open market</Link>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-3 max-[820px]:grid-cols-2">
        <Tile k="Your inventory backing it" v={chain ? `${Math.round(chain.vault.juniorUnits).toLocaleString()} ${D.property.symbol}` : '—'} s={chain ? `+ ${usd(chain.vault.juniorUsd)} USD buffer` : ''} />
        <Tile k="Locked for" v={lockDays === null ? '—' : `${lockDays} days`} s="redeemable after the lock, once LPs are covered" />
        <Tile k="Open liquidity on top" v={live ? usd(live.vault.seniorUsd) : '—'} s={live ? `${usd(live.vault.deployedUsd)} of it in the pool` : ''} />
        <Tile k="USD cover of the pool slice" v={cover === null ? '—' : `${Math.round(cover * 100)}%`} s="your USD buffer ÷ LP dollars in the pool" tone={cover !== null && cover < 0.1 ? 'warn' : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 max-[820px]:grid-cols-1">
        <Tile k={live?.source === 'live' ? 'Current appraisal' : 'Appraisal at snapshot'} v={live ? usd(live.appraisal.usd, 2) : '—'} s={live ? `posted ${ago(now - live.appraisal.at)}` : ''} />
        <Tile k="Next update allowed" v={nextUpdate === null ? '—' : nextUpdate === 0 ? 'now' : `in ${ago(nextUpdate).replace(' ago', '')}`} s="the contract rate-limits appraisals" />
        <Tile k="Appraisal valid for" v={ageLeft === null ? '—' : ageLeft <= 0 ? 'expired' : `${Math.round(ageLeft / 86400)} more days`} s="after that trading halts and LPs get an exit window" tone={ageLeft !== null && ageLeft < 7 * 86400 ? 'warn' : undefined} />
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-soft">
        <span>Issuer <a href={ex.addr(D.issuer)} target="_blank" rel="noreferrer" className="font-geist-mono text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.issuer)}</a></span>
        <span>Vault <a href={ex.addr(D.contracts.vault)} target="_blank" rel="noreferrer" className="font-geist-mono text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.contracts.vault)}</a></span>
        <span>Hook <a href={ex.addr(D.contracts.hook)} target="_blank" rel="noreferrer" className="font-geist-mono text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.contracts.hook)}</a></span>
        <span>Registry <a href={ex.addr(D.contracts.registry)} target="_blank" rel="noreferrer" className="font-geist-mono text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.contracts.registry)}</a> (testnet stand-in for your transfer agent)</span>
      </div>
    </div>
  )
}

function Tile({ k, v, s, tone }: { k: string; v: string; s?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-[14px] px-4 py-3" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
      <div className="text-[12px] text-ink-soft">{k}</div>
      <div className={`mt-1 font-geist-mono text-[18px] tracking-[-0.02em] ${tone === 'warn' ? 'text-[#9A3F1C]' : ''}`}>{v}</div>
      {s && <div className="mt-1 text-[11.5px] leading-[1.4] text-ink-soft">{s}</div>}
    </div>
  )
}

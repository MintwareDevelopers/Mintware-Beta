'use client'

// Team › RWA issuance — the issuer's side of the RWA vertical: each liquidity unit the org issues, read live from
// chain (first-loss inventory + lock, how much of the pool it covers, appraisal health, band). Read-only today:
// appraisals are posted by the unit's keeper seat, and listing a new asset is an operator-run deploy (no factory
// yet) — the page says both plainly instead of offering buttons that don't exist.

import Link from 'next/link'
import { RWA_UNITS, explorer, shortHash, type RwaUnit } from '@/lib/rwa/demo'
import { useRwaUnit, usd, ago, rwaStatus, STATUS_CLS } from './useRwaUnit'

export function RwaIssuerConsole() {
  return (
    <div className="text-ink">
      <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#B4532A]">RWA issuance</div>
      <h1 className="mt-3 font-atx-display text-[clamp(1.8rem,3.4vw,2.4rem)] font-semibold tracking-[-0.03em] leading-[1.08]">Your assets&apos; liquidity units</h1>
      <p className="mt-3 max-w-[66ch] text-[14.5px] leading-[1.6] text-ink-mid">
        You keep the licence, the investor registry and the token&apos;s rules. Each asset gets a liquidity unit: your
        inventory sits as first-loss, open liquidity providers supply dollars on top, and trading stays anchored to your
        appraisal.
      </p>

      <div className="mt-7 grid gap-5">
        {RWA_UNITS.map((u) => <UnitCard key={u.slug} unit={u} />)}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 max-[820px]:grid-cols-1">
        <div className="rounded-[20px] border border-dashed border-hair bg-white p-6">
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft">List another asset</div>
          <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-mid">
            Today Mintware deploys each unit with you — the vault, the appraisal hook and the pool — and enrols the pool,
            vault and router with your transfer agent once. Self-serve listing arrives with the unit factory.
          </p>
          <Link href="/app/rwa/how" className="mt-3 inline-flex text-[13px] font-semibold text-peri-deep no-underline hover:underline">How a unit is set up →</Link>
        </div>
        <div className="rounded-[20px] border border-hair bg-white p-6">
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Appraisals</div>
          <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-mid">
            New appraisals are posted on-chain by your unit&apos;s keeper. The contract caps every step, the update rate and
            the daily drift, and changing the keeper waits 48 hours — so no one, including you, can jerk the price.
          </p>
        </div>
      </div>
    </div>
  )
}

function UnitCard({ unit }: { unit: RwaUnit }) {
  const { unit: live, now } = useRwaUnit(unit.slug, 30_000)
  const ex = explorer(unit)
  const D = unit.demo
  const status = rwaStatus(live)
  const lockDays = live ? Math.max(0, Math.round((live.vault.lockExpiry - now) / 86400)) : null
  const cover = live && live.vault.deployedUsd > 0 ? live.vault.juniorUsd / live.vault.deployedUsd : null
  const nextUpdate = live && live.appraisal.minUpdateSecs ? Math.max(0, live.appraisal.at + live.appraisal.minUpdateSecs - now) : null
  const ageLeft = live && live.appraisal.maxAgeSecs ? live.appraisal.at + live.appraisal.maxAgeSecs - now : null

  return (
    <div className="rounded-[22px] border border-hair bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[12px] text-ink-mid"><span className="h-2 w-2 rounded-full bg-mw-live" />{unit.chain.name} · {D.property.symbol}</div>
          <div className="mt-1 font-atx-display text-[20px] font-semibold">{D.property.name.replace(' (demo)', '')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status && <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${STATUS_CLS[status.tone]}`}>{status.t}</span>}
          <Link href={`/app/rwa/${unit.slug}`} className="glass-pill glass-pill-sm no-underline">Open market</Link>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-3 max-[820px]:grid-cols-2">
        <Tile k="Your first-loss inventory" v={live ? `${Math.round(live.vault.juniorUnits).toLocaleString()} ${D.property.symbol}` : '—'} s={live ? `+ ${usd(live.vault.juniorUsd)} USD buffer` : ''} />
        <Tile k="Locked for" v={lockDays === null ? '—' : `${lockDays} days`} s="redeemable after the lock, once LPs are covered" />
        <Tile k="Open liquidity on top" v={live ? usd(live.vault.seniorUsd) : '—'} s={live ? `${usd(live.vault.deployedUsd)} of it in the pool` : ''} />
        <Tile k="USD cover of the pool slice" v={cover === null ? '—' : `${Math.round(cover * 100)}%`} s="your USD buffer ÷ senior USD in the pool" tone={cover !== null && cover < 0.1 ? 'warn' : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 max-[820px]:grid-cols-1">
        <Tile k="Current appraisal" v={live ? usd(live.appraisal.usd, 2) : '—'} s={live ? `posted ${ago(now - live.appraisal.at)}` : ''} />
        <Tile k="Next update allowed" v={nextUpdate === null ? '—' : nextUpdate === 0 ? 'now' : `in ${ago(nextUpdate).replace(' ago', '')}`} s="the contract rate-limits appraisals" />
        <Tile k="Appraisal valid for" v={ageLeft === null ? '—' : ageLeft <= 0 ? 'expired' : `${Math.round(ageLeft / 86400)} more days`} s="after that trading halts and LPs get an exit window" tone={ageLeft !== null && ageLeft < 7 * 86400 ? 'warn' : undefined} />
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-soft">
        <span>Issuer <a href={ex.addr(D.issuer)} target="_blank" rel="noreferrer" className="font-atx-mono text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.issuer)}</a></span>
        <span>Vault <a href={ex.addr(D.contracts.vault)} target="_blank" rel="noreferrer" className="font-atx-mono text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.contracts.vault)}</a></span>
        <span>Hook <a href={ex.addr(D.contracts.hook)} target="_blank" rel="noreferrer" className="font-atx-mono text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.contracts.hook)}</a></span>
        <span>Registry <a href={ex.addr(D.contracts.registry)} target="_blank" rel="noreferrer" className="font-atx-mono text-ink-mid no-underline hover:text-peri-deep">{shortHash(D.contracts.registry)}</a> (testnet stand-in for your transfer agent)</span>
      </div>
    </div>
  )
}

function Tile({ k, v, s, tone }: { k: string; v: string; s?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-[14px] bg-ground-cool px-4 py-3">
      <div className="text-[11px] text-ink-soft">{k}</div>
      <div className={`mt-0.5 font-atx-display text-[18px] font-semibold tabular-nums ${tone === 'warn' ? 'text-[#B4532A]' : ''}`}>{v}</div>
      {s && <div className="mt-0.5 text-[11px] text-ink-soft">{s}</div>}
    </div>
  )
}

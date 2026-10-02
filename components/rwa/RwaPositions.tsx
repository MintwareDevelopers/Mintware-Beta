'use client'

// Personal › Earn › RWA liquidity — the retail side of the RWA vertical: every RWA unit you can supply liquidity
// to, and your position in each (read from the vault on its chain). Supplying itself happens on the market page.

import Link from 'next/link'
import { formatUnits } from 'viem'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { RWA_UNITS, type RwaUnit } from '@/lib/rwa/demo'
import { useRwaUnit, usd } from './useRwaUnit'
import { useRwaPosition } from './useRwaPosition'

export function RwaPositions() {
  const { address } = useMintwareIdentity()
  return (
    <div className="max-w-[1080px] mx-auto px-8 py-10 max-[900px]:px-5 text-ink">
      <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#1F7A6A]">Earn · RWA liquidity</div>
      <h1 className="mt-3 font-atx-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-semibold tracking-[-0.03em] leading-[1.05]">Supply liquidity to real-world assets</h1>
      <p className="mt-3 max-w-[64ch] text-[15px] leading-[1.6] text-ink-mid">
        Each tokenized property has its own market. You supply dollars to its senior tranche — you never hold the
        property token — and the issuer&apos;s own inventory sits beneath you as first-loss. Idle liquidity is lent out
        until a trade needs it.
      </p>
      <div className="mt-8 grid gap-4">
        {RWA_UNITS.map((u) => <UnitRow key={u.slug} unit={u} address={address as `0x${string}` | undefined} />)}
      </div>
      <p className="mt-8 max-w-[86ch] text-[12px] leading-[1.6] text-ink-soft">
        Testnet demonstration: fictional property, valueless test tokens, simulated lending yield, unaudited contracts.
        A liquidity position is not a deposit, a savings product, or a guaranteed or fixed return. Who may supply
        liquidity to a real asset is a legal question still being answered with counsel.
      </p>
    </div>
  )
}

function UnitRow({ unit, address }: { unit: RwaUnit; address?: `0x${string}` }) {
  const { unit: live, interest } = useRwaUnit(unit.slug, 30_000)
  const pos = useRwaPosition(unit, unit.liveTrade ? address : undefined)
  const share = live && live.vault.seniorUsd > 0 && pos.valueAtomic > 0n ? Number(formatUnits(pos.valueAtomic, 6)) / live.vault.seniorUsd : 0
  return (
    <div className="rounded-[22px] border border-hair bg-white p-6 grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-5 max-[860px]:grid-cols-2 max-[520px]:grid-cols-1">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12px] text-ink-mid"><span className="h-2 w-2 rounded-full bg-mw-live" />{unit.chain.name}</div>
        <div className="mt-1 font-atx-display text-[18px] font-semibold truncate">{unit.demo.property.name.replace(' (demo)', '')}</div>
        <div className="text-[12.5px] text-ink-soft">{live ? `${usd(live.vault.seniorUsd)} supplied · ${live.lending.aprPct}% simulated lending rate` : 'Reading the vault…'}</div>
      </div>
      <div>
        <div className="text-[11px] text-ink-soft">Your position</div>
        <div className="font-atx-display text-[20px] font-semibold tabular-nums">{!unit.liveTrade ? '—' : !address ? 'Connect' : usd(Number(formatUnits(pos.valueAtomic, 6)), 2)}</div>
      </div>
      <div>
        <div className="text-[11px] text-ink-soft">Your share of interest so far</div>
        <div className="font-atx-mono text-[16px] font-semibold tabular-nums text-[#1F7A6A]">{interest !== null && share > 0 ? usd(interest * share, 4) : '—'}</div>
      </div>
      <Link href={`/app/rwa/${unit.slug}${unit.liveTrade ? '#supply' : ''}`} className="glass-pill-primary !px-5 no-underline whitespace-nowrap">{unit.liveTrade ? 'Supply / redeem →' : 'View market →'}</Link>
    </div>
  )
}

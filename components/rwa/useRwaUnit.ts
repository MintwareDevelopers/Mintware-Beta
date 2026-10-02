'use client'

// One live read of an RWA liquidity unit (GET /api/rwa/unit, polled), shared by the overview, the market
// page and the proof page so they can never disagree about the numbers.

import { useCallback, useEffect, useMemo, useState } from 'react'

export type RwaUnitLive = {
  ok: boolean
  block: number
  blockTime: number
  appraisal: { tick: number; usd: number; at: number; fresh: boolean; oracleReady: boolean; maxAgeSecs: number | null; minUpdateSecs: number | null }
  spot: { tick: number; usd: number; deviationTicks: number; inCore: boolean; inSpec: boolean }
  band: { core: [number, number]; spec: [number, number]; coreFeePct: number; specFeePct: number } | null
  tradingPaused: boolean
  vault: { seniorUsd: number; deployedUsd: number; juniorUnits: number; juniorUsd: number; lockExpiry: number }
  lending: { balanceUsd: number; pendingUsd: number; aprPct: number; interestMintedUsd: number; simulated: boolean }
  trades: { tx: string; block: number; ts: number | null; trader: string | null; side: 'buy' | 'sell'; usd: number; units: number; priceUsd: number }[]
  tradeCount: number
  priceSeries: { block: number; ts: number | null; usd: number; byVault: boolean }[]
  appraisalSeries: { block: number; ts: number | null; usd: number }[]
}

export function useRwaUnit(slug: string, pollMs = 12_000) {
  const [unit, setUnit] = useState<RwaUnitLive | null>(null)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now() / 1000)

  const load = useCallback((fresh = false) =>
    fetch(`/api/rwa/unit?unit=${slug}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: RwaUnitLive) => { if (d.ok) { setUnit(d); setFailed(false) } else setFailed(true) })
      .catch(() => setFailed(true)), [slug])

  useEffect(() => {
    load()
    const poll = setInterval(() => load(), pollMs)
    const tick = setInterval(() => setNow(Date.now() / 1000), 1_000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load, pollMs])

  // Interest keeps accruing between polls: extrapolate client-side at the venue's rate.
  const interest = useMemo(() => {
    if (!unit) return null
    const perSec = (unit.lending.balanceUsd * unit.lending.aprPct) / 100 / (365 * 86400)
    return unit.lending.interestMintedUsd + unit.lending.pendingUsd + perSec * Math.max(0, now - unit.blockTime)
  }, [unit, now])

  return { unit, failed, now, interest, reload: load }
}

export const usd = (n: number, d = 0) => `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
export const ago = (secs: number) => {
  if (secs < 90) return `${Math.max(1, Math.round(secs))}s ago`
  if (secs < 5400) return `${Math.round(secs / 60)} min ago`
  if (secs < 172800) return `${Math.round(secs / 3600)} h ago`
  return `${Math.round(secs / 86400)} days ago`
}

export type RwaStatus = { t: string; tone: 'good' | 'info' | 'warn' }
export function rwaStatus(unit: RwaUnitLive | null): RwaStatus | null {
  if (!unit) return null
  if (unit.tradingPaused) return { t: 'Trading paused', tone: 'warn' }
  if (!unit.appraisal.fresh && unit.appraisal.oracleReady) return { t: 'Appraisal stale — trading halted, exit window open', tone: 'warn' }
  if (!unit.appraisal.fresh) return { t: 'Appraisal expired — awaiting a new appraisal', tone: 'warn' }
  if (unit.spot.inCore) return { t: 'Trading inside the core band', tone: 'good' }
  if (unit.spot.inSpec) return { t: 'Trading inside the band', tone: 'info' }
  return { t: 'Outside the band — gap-closing trades only', tone: 'warn' }
}
export const STATUS_CLS: Record<RwaStatus['tone'], string> = {
  good: 'text-[#2F7D5B] bg-[rgba(47,125,91,0.10)]',
  info: 'text-peri-deep bg-[rgba(108,108,240,0.10)]',
  warn: 'text-[#B4532A] bg-[rgba(232,138,103,0.14)]',
}

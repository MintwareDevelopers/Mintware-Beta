import { API } from '@/lib/web2/api'
import { classifyTradeSignal } from './classifier'
import { aggregateTradeSignalAllocations } from './allocator'
import type {
  AttributionBand,
  ClassifiedTradeSignal,
  TradeSignalRecord,
  UniversalAllocationPolicy,
  UniversalAllocationSummary,
} from './types'

const FETCH_CONCURRENCY = 5

export interface TradeSignalLedgerRow extends TradeSignalRecord {
  created_at: string
}

export interface UniversalEpochAllocationResult {
  classified: ClassifiedTradeSignal[]
  summary: UniversalAllocationSummary
}

export function attributionBandFromPercentile(percentile: number): AttributionBand {
  if (percentile >= 67) return 'high'
  if (percentile >= 34) return 'mid'
  return 'low'
}

export function floorToEpochStart(timestampIso: string, epochHours: number): string {
  const date = new Date(timestampIso)
  const epochMs = epochHours * 60 * 60 * 1000
  const floored = Math.floor(date.getTime() / epochMs) * epochMs
  return new Date(floored).toISOString()
}

export function epochEndFromStart(epochStartIso: string, epochHours: number): string {
  const start = new Date(epochStartIso).getTime()
  return new Date(start + epochHours * 60 * 60 * 1000).toISOString()
}

export function makeUniversalEpochKey(chainId: number, poolId: string, epochStartIso: string): string {
  return `${chainId}:${poolId}:${epochStartIso}`
}

async function withConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let idx = 0

  async function worker() {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function fetchAttributionPercentile(wallet: string): Promise<number> {
  try {
    const res = await fetch(`${API}/score?address=${wallet}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return 0
    const data = await res.json() as { percentile?: number }
    return data.percentile ?? 0
  } catch {
    return 0
  }
}

function rawToStableUsd(rawAmount: string, stableDecimals: number): number {
  const value = Number(rawAmount)
  if (!Number.isFinite(value)) return 0
  return Math.round((value / 10 ** stableDecimals) * 1e6) / 1e6
}

export async function allocateUniversalEpoch(args: {
  signals: TradeSignalLedgerRow[]
  policy: UniversalAllocationPolicy
  stableDecimals?: number
}): Promise<UniversalEpochAllocationResult> {
  const stableDecimals = args.stableDecimals ?? 6
  const uniqueSwappers = Array.from(new Set(args.signals.map((signal) => signal.swapper.toLowerCase())))

  const percentiles = await withConcurrency(uniqueSwappers, FETCH_CONCURRENCY, fetchAttributionPercentile)
  const percentileMap = new Map<string, number>()
  uniqueSwappers.forEach((wallet, index) => percentileMap.set(wallet, percentiles[index] ?? 0))

  const classified = args.signals.map((signal) => {
    const percentile = percentileMap.get(signal.swapper.toLowerCase()) ?? 0
    const amountOutUsd = rawToStableUsd(signal.amount_out_raw, stableDecimals)
    const captureUsd = rawToStableUsd(signal.capture_amount_raw, stableDecimals)

    return classifyTradeSignal(signal, {
      amount_out_usd: amountOutUsd,
      capture_usd: captureUsd,
      attribution_band: attributionBandFromPercentile(percentile),
      referral_eligible: Boolean(signal.referrer),
    })
  })

  const summary = aggregateTradeSignalAllocations(classified, args.policy)
  return { classified, summary }
}

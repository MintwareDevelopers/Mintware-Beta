import type {
  AttributionBand,
  ClassifiedTradeSignal,
  UniversalAllocationEntry,
  UniversalAllocationPolicy,
  UniversalAllocationSummary,
} from './types'

const BAND_ORDER: Record<AttributionBand, number> = {
  low: 0,
  mid: 1,
  high: 2,
}

function canReceiveRebate(band: AttributionBand, minimumBand: AttributionBand | undefined): boolean {
  if (!minimumBand) return true
  return BAND_ORDER[band] >= BAND_ORDER[minimumBand]
}

function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function valueUsd(signal: ClassifiedTradeSignal): number {
  return roundUsd(signal.capture_usd + signal.fee_usd)
}

export function allocateTradeSignal(
  signal: ClassifiedTradeSignal,
  policy: UniversalAllocationPolicy
): UniversalAllocationEntry[] {
  const totalValueUsd = valueUsd(signal)
  if (totalValueUsd <= 0) return []

  const entries: UniversalAllocationEntry[] = []
  const treasuryUsd = roundUsd(totalValueUsd * policy.treasury_share_bps / 10_000)
  const referrerUsd = signal.quality === 'referral' && signal.referrer
    ? roundUsd(totalValueUsd * policy.referrer_share_bps / 10_000)
    : 0
  const traderUsd = signal.quality !== 'toxic' && canReceiveRebate(signal.attribution_band, policy.minimum_rebate_band)
    ? roundUsd(totalValueUsd * policy.trader_rebate_bps / 10_000)
    : 0

  const lpUsd = roundUsd(totalValueUsd - treasuryUsd - referrerUsd - traderUsd)

  if (lpUsd > 0) {
    entries.push({
      recipient: signal.pool_id,
      recipient_type: 'lp_pool',
      source_trade_ids: [signal.id],
      quality: signal.quality,
      amount_usd: lpUsd,
    })
  }

  if (traderUsd > 0) {
    entries.push({
      recipient: signal.swapper,
      recipient_type: 'trader',
      source_trade_ids: [signal.id],
      quality: signal.quality,
      amount_usd: traderUsd,
    })
  }

  if (referrerUsd > 0 && signal.referrer) {
    entries.push({
      recipient: signal.referrer,
      recipient_type: 'referrer',
      source_trade_ids: [signal.id],
      quality: signal.quality,
      amount_usd: referrerUsd,
    })
  }

  if (treasuryUsd > 0) {
    entries.push({
      recipient: policy.treasury_address.toLowerCase(),
      recipient_type: 'treasury',
      source_trade_ids: [signal.id],
      quality: signal.quality,
      amount_usd: treasuryUsd,
    })
  }

  return entries
}

export function aggregateTradeSignalAllocations(
  signals: ClassifiedTradeSignal[],
  policy: UniversalAllocationPolicy
): UniversalAllocationSummary {
  const aggregated = new Map<string, UniversalAllocationEntry>()
  let totalValueUsd = 0

  for (const signal of signals) {
    totalValueUsd = roundUsd(totalValueUsd + valueUsd(signal))

    for (const entry of allocateTradeSignal(signal, policy)) {
      const key = `${entry.recipient_type}:${entry.recipient}`
      const existing = aggregated.get(key)
      if (existing) {
        existing.amount_usd = roundUsd(existing.amount_usd + entry.amount_usd)
        existing.source_trade_ids = Array.from(new Set([...existing.source_trade_ids, ...entry.source_trade_ids]))
      } else {
        aggregated.set(key, { ...entry })
      }
    }
  }

  const entries = Array.from(aggregated.values()).sort((a, b) => b.amount_usd - a.amount_usd)
  const totalAllocatedUsd = roundUsd(entries.reduce((sum, entry) => sum + entry.amount_usd, 0))

  return {
    entries,
    total_value_usd: totalValueUsd,
    total_allocated_usd: totalAllocatedUsd,
  }
}

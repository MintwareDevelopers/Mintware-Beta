import type {
  ClassifiedTradeSignal,
  TradeClassificationContext,
  TradeQuality,
  TradeSignalRecord,
} from './types'

function classifyQuality(signal: TradeSignalRecord, ctx: TradeClassificationContext): { quality: TradeQuality, reasons: string[] } {
  const reasons: string[] = []

  if (BigInt(signal.capture_amount_raw) > 0n || (ctx.capture_usd ?? 0) > 0) {
    reasons.push('captured_value_detected')
    return { quality: 'toxic', reasons }
  }

  if (signal.referrer && ctx.referral_eligible) {
    reasons.push('valid_referrer_present')
    return { quality: 'referral', reasons }
  }

  reasons.push('default_noise_flow')
  return { quality: 'noise', reasons }
}

export function classifyTradeSignal(
  signal: TradeSignalRecord,
  ctx: TradeClassificationContext
): ClassifiedTradeSignal {
  const { quality, reasons } = classifyQuality(signal, ctx)
  const fee_usd = Math.round(ctx.amount_out_usd * (signal.dynamic_fee_bps / 10_000) * 1e6) / 1e6

  return {
    ...signal,
    quality,
    attribution_band: ctx.attribution_band,
    amount_out_usd: ctx.amount_out_usd,
    capture_usd: ctx.capture_usd ?? 0,
    fee_usd,
    reasons,
  }
}

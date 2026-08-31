// Adaptive buffer-sizing tuner — the spend agent's safety-stock tuning job (spec §5.3). Reads a card's
// settled spend history, derives (μ_L, σ) via lib/cards/bufferTuning, and EMA-blends the card's stored
// sizing inputs toward the measured values, then recomputes the target. Converges each member's buffer
// toward their ACTUAL spend distribution instead of a static default. No capital moves here — it only
// shapes the target the refill loop aims at (which is itself gated + rate-capped).

import { getServiceClient } from '@/lib/web2/supabase'
import { computeDemandStats, blendToward, type DemandSwipe } from '@/lib/cards/bufferTuning'
import { bufferTargetAtomic } from '@/lib/cards/bufferSizing'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = { info: (t: string, m: string, c?: Record<string, unknown>) => void }

const DAY = 86_400
const big = (v: unknown) => { try { return BigInt(String(v ?? '0')) } catch { return 0n } }
const envInt = (k: string, d: number) => {
  const n = Number(process.env[k])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d
}

export type TuneResult =
  | { ok: true; sampleCount: number; meanLeadtimeAtomic: string; demandStdevAtomic: string; targetAtomic: string }
  | { ok: false; reason: 'not_found' | 'insufficient_samples' }

/** Re-derive and EMA-blend a card's sizing inputs from its settled swipe history, then persist the new
 *  inputs + recomputed target. Skips (leaving the row untouched) until at least CARD_BUFFER_TUNE_MIN_SAMPLES
 *  swipes exist in the window, so a brand-new card keeps its seeded profile defaults. */
export async function tuneBufferSizing(opts: {
  supabase: SupabaseClient
  orgCardId: string
  nowSecs?: number
  log?: Logger
}): Promise<TuneResult> {
  const { supabase, orgCardId, log } = opts
  const nowSecs = opts.nowSecs ?? Math.floor(Date.now() / 1000)
  const windowSecs = envInt('CARD_BUFFER_TUNE_WINDOW_SECS', 30 * DAY)
  const alphaBps = envInt('CARD_BUFFER_TUNE_ALPHA_BPS', 3000)
  const minSamples = envInt('CARD_BUFFER_TUNE_MIN_SAMPLES', 5)

  const { data: buf } = await supabase
    .from('card_spend_buffers')
    .select('id, sigma_period_secs, lead_time_secs, service_level_bps, mean_demand_leadtime_atomic, demand_stdev_atomic')
    .eq('org_card_id', orgCardId)
    .maybeSingle()
  if (!buf) return { ok: false, reason: 'not_found' }

  const sinceIso = new Date((nowSecs - windowSecs) * 1000).toISOString()
  const { data: rows } = await supabase
    .from('card_swipe_events')
    .select('amount_atomic_usdc, created_at')
    .eq('org_card_id', orgCardId)
    .eq('decision', 'approved')
    .eq('settled', true)
    .gte('created_at', sinceIso)
    .limit(5000)

  const swipes: DemandSwipe[] = ((rows ?? []) as Array<{ amount_atomic_usdc: unknown; created_at: string }>)
    .map((r) => ({ amountAtomic: big(r.amount_atomic_usdc), atSecs: Math.floor(Date.parse(r.created_at) / 1000) }))
    .filter((s) => s.amountAtomic > 0n && Number.isFinite(s.atSecs))

  const stats = computeDemandStats({
    swipes,
    nowSecs,
    observationWindowSecs: windowSecs,
    sigmaPeriodSecs: Number(buf.sigma_period_secs),
    leadTimeSecs: Number(buf.lead_time_secs),
  })
  if (stats.sampleCount < minSamples) return { ok: false, reason: 'insufficient_samples' }

  const newMean = blendToward(big(buf.mean_demand_leadtime_atomic), stats.meanLeadtimeAtomic, alphaBps)
  const newStdev = blendToward(big(buf.demand_stdev_atomic), stats.demandStdevAtomic, alphaBps)
  const target = bufferTargetAtomic({
    meanDemandLeadTimeAtomic: newMean,
    demandStdevAtomic: newStdev,
    sigmaPeriodSecs: Number(buf.sigma_period_secs),
    leadTimeSecs: Number(buf.lead_time_secs),
    serviceLevelBps: Number(buf.service_level_bps),
  })

  await supabase
    .from('card_spend_buffers')
    .update({
      mean_demand_leadtime_atomic: newMean.toString(),
      demand_stdev_atomic: newStdev.toString(),
      buffer_target_atomic: target.toString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', buf.id)

  log?.info('cards.tune', 'buffer sizing tuned', { orgCardId, samples: stats.sampleCount, target: target.toString() })
  return { ok: true, sampleCount: stats.sampleCount, meanLeadtimeAtomic: newMean.toString(), demandStdevAtomic: newStdev.toString(), targetAtomic: target.toString() }
}

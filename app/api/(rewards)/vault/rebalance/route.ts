// POST /api/vault/rebalance
// Triggers range proposal pipeline for a vault.
// Auth: Bearer CRON_SECRET

import { createHandler } from '@/lib/web2/routeHandler'
import { computeVolatilityMetrics } from '@/lib/web3/vault/volatilityMonitor'
import { proposeRebalance }         from '@/lib/web3/vault/rangeProposer'
import { getServiceClient }         from '@/lib/web2/supabase'

export const dynamic = 'force-dynamic'

async function expireStaleProposals(vaultId: string) {
  const supabase = getServiceClient()
  const nowSecs  = Math.floor(Date.now() / 1000)
  await supabase
    .from('vault_rebalance_proposals')
    .update({ status: 'expired' })
    .eq('vault_id', vaultId).eq('status', 'pending').lt('valid_until', nowSecs)
}

export const POST = createHandler(async (req, ctx) => {
  let body: Record<string, unknown>
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'Invalid JSON body' }, 400) }

  const {
    vault_id, feed_id, current_tick_lower, current_tick_upper,
    tick_spacing = 60, chain = 'base_sepolia', window_hours = 168, forced = false,
  } = body as {
    vault_id: string; feed_id: string; current_tick_lower: number; current_tick_upper: number
    tick_spacing?: number; chain?: 'base' | 'base_sepolia'; window_hours?: number; forced?: boolean
  }

  if (!vault_id)                               return ctx.json({ error: 'vault_id is required' }, 400)
  if (!feed_id)                                return ctx.json({ error: 'feed_id is required' }, 400)
  if (current_tick_lower === undefined)        return ctx.json({ error: 'current_tick_lower is required' }, 400)
  if (current_tick_upper === undefined)        return ctx.json({ error: 'current_tick_upper is required' }, 400)
  if (current_tick_lower >= current_tick_upper) return ctx.json({ error: 'current_tick_lower must be less than current_tick_upper' }, 400)
  if (!['base', 'base_sepolia'].includes(chain)) return ctx.json({ error: 'chain must be "base" or "base_sepolia"' }, 400)

  let metrics
  try {
    metrics = await computeVolatilityMetrics(feed_id, window_hours, tick_spacing)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('insufficient data') || message.includes('no candle data'))
      return ctx.json({ error: `Insufficient Pyth data: ${message}` }, 422)
    ctx.log.error('vault/rebalance', 'computeVolatilityMetrics failed', { error: message })
    return ctx.json({ error: 'Failed to fetch volatility data' }, 500)
  }

  try { await expireStaleProposals(vault_id) } catch (err) {
    ctx.log.warn('vault/rebalance', 'Failed to expire stale proposals', { error: String(err) })
  }

  try {
    const { decision, proposal } = await proposeRebalance(
      vault_id, { tickLower: current_tick_lower, tickUpper: current_tick_upper }, metrics, chain, forced,
    )
    return ctx.json({
      rebalance_needed: decision.shouldRebalance, reason: decision.reason,
      metrics: { currentPrice: metrics.currentPrice, atrPct: metrics.atrPct, bollingerWidthPct: metrics.bollinger.widthPct, confidence: metrics.confidence },
      proposal: proposal ?? null,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    ctx.log.error('vault/rebalance', 'proposeRebalance failed', { error: message })
    return ctx.json({ error: 'Failed to generate range proposal' }, 500)
  }
}, { auth: 'bearer-token' })

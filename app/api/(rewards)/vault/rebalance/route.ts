// POST /api/vault/rebalance
//
// Triggers the T4.2 range proposal pipeline for a single vault:
//   1. Fetches current volatility metrics via computeVolatilityMetrics (T4.1)
//   2. Runs assessRebalanceNeed against the vault's current tick range
//   3. If rebalance needed: signs a RangeProposal with oracle key + stores in DB
//   4. Returns the decision + proposal (if any)
//
// Auth: Bearer CRON_SECRET  (same as other cron routes in this codebase)
//
// Body (JSON):
//   vault_id           — social_vaults UUID (required)
//   feed_id            — Pyth price feed ID, 32-byte hex (required)
//   current_tick_lower — current on-chain tickLower (required)
//   current_tick_upper — current on-chain tickUpper (required)
//   tick_spacing       — V4 pool tick spacing for range alignment (default 60)
//   chain              — 'base' | 'base_sepolia' (default 'base_sepolia' until mainnet)
//   window_hours       — volatility lookback in hours (default 168 = 7 days)
//   forced             — boolean; if true, always propose even if not needed (epoch-boundary use)
//
// Responses:
//   200 { rebalance_needed: false, reason: 'none', ... }
//   200 { rebalance_needed: true,  reason, proposal: SignedRangeProposal }
//   400 missing / invalid params
//   401 missing / wrong auth
//   422 insufficient volatility data from Pyth
//   500 signing or DB failure

import { NextRequest, NextResponse } from 'next/server'
import { computeVolatilityMetrics } from '@/lib/web3/vault/volatilityMonitor'
import { proposeRebalance }         from '@/lib/web3/vault/rangeProposer'

export const dynamic = 'force-dynamic'

// Expire any stale pending proposals before inserting a new one
async function expireStaleProposals(vaultId: string) {
  const { createSupabaseServiceClient } = await import('@/lib/web2/supabase')
  const supabase = createSupabaseServiceClient()
  const nowSecs  = Math.floor(Date.now() / 1000)
  await supabase
    .from('vault_rebalance_proposals')
    .update({ status: 'expired' })
    .eq('vault_id', vaultId)
    .eq('status', 'pending')
    .lt('valid_until', nowSecs)
}

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    vault_id,
    feed_id,
    current_tick_lower,
    current_tick_upper,
    tick_spacing   = 60,
    chain          = 'base_sepolia',
    window_hours   = 168,
    forced         = false,
  } = body as {
    vault_id:           string
    feed_id:            string
    current_tick_lower: number
    current_tick_upper: number
    tick_spacing?:      number
    chain?:             'base' | 'base_sepolia'
    window_hours?:      number
    forced?:            boolean
  }

  if (!vault_id)           return NextResponse.json({ error: 'vault_id is required' },           { status: 400 })
  if (!feed_id)            return NextResponse.json({ error: 'feed_id is required' },            { status: 400 })
  if (current_tick_lower === undefined) return NextResponse.json({ error: 'current_tick_lower is required' }, { status: 400 })
  if (current_tick_upper === undefined) return NextResponse.json({ error: 'current_tick_upper is required' }, { status: 400 })
  if (current_tick_lower >= current_tick_upper) {
    return NextResponse.json({ error: 'current_tick_lower must be less than current_tick_upper' }, { status: 400 })
  }
  if (!['base', 'base_sepolia'].includes(chain)) {
    return NextResponse.json({ error: 'chain must be "base" or "base_sepolia"' }, { status: 400 })
  }

  // ── Fetch volatility metrics ──────────────────────────────────────────────
  let metrics
  try {
    metrics = await computeVolatilityMetrics(feed_id, window_hours, tick_spacing)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('insufficient data') || message.includes('no candle data')) {
      return NextResponse.json({ error: `Insufficient Pyth data: ${message}` }, { status: 422 })
    }
    console.error('[rebalance] computeVolatilityMetrics failed:', message)
    return NextResponse.json({ error: 'Failed to fetch volatility data' }, { status: 500 })
  }

  // ── Expire stale proposals (best-effort, non-fatal) ───────────────────────
  try {
    await expireStaleProposals(vault_id)
  } catch (err) {
    console.warn('[rebalance] Failed to expire stale proposals:', err)
  }

  // ── Run proposal pipeline ─────────────────────────────────────────────────
  try {
    const { decision, proposal } = await proposeRebalance(
      vault_id,
      { tickLower: current_tick_lower, tickUpper: current_tick_upper },
      metrics,
      chain,
      forced,
    )

    return NextResponse.json({
      rebalance_needed: decision.shouldRebalance,
      reason:           decision.reason,
      metrics: {
        currentPrice:     metrics.currentPrice,
        atrPct:           metrics.atrPct,
        bollingerWidthPct: metrics.bollinger.widthPct,
        confidence:       metrics.confidence,
      },
      proposal: proposal ?? null,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[rebalance] proposeRebalance failed:', message)
    return NextResponse.json({ error: 'Failed to generate range proposal' }, { status: 500 })
  }
}

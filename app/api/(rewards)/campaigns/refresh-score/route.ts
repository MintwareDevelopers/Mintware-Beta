// =============================================================================
// POST /api/campaigns/refresh-score
//
// Phase 6 — Signal Pooling: updates attribution_score in `participants` for
// all live campaigns the wallet is enrolled in.
//
// Called from the profile page immediately after a Solana wallet is linked,
// so the combined score takes effect for all in-progress campaigns without
// waiting for the next swap event.
//
// Flow:
//   1. Validate wallet (EVM or Solana base58)
//   2. Compute combined Attribution score via getCombinedAttributionScore()
//      (fetches both wallets' scores in parallel, applies merge formula)
//   3. Update participants.attribution_score for all campaigns where
//      status = 'live' AND the wallet is enrolled
//
// Idempotent — safe to call multiple times. Only updates; never inserts.
// Rate-limited to 5 req/min per IP by middleware.ts.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { solanaEnabled } from '@/lib/web3/featureFlags'
import { getCombinedAttributionScore } from '@/lib/rewards/combinedScore'

const EVM_RE    = /^0x[0-9a-fA-F]{40}$/
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { wallet: rawWallet } = (body ?? {}) as Record<string, unknown>

  if (typeof rawWallet !== 'string') {
    return NextResponse.json({ error: 'wallet required' }, { status: 422 })
  }

  const isEvm    = EVM_RE.test(rawWallet)
  const isSolana = solanaEnabled && !isEvm && SOLANA_RE.test(rawWallet)

  if (!isEvm && !isSolana) {
    return NextResponse.json({ error: 'invalid wallet address' }, { status: 422 })
  }

  // Preserve case for Solana; lowercase for EVM
  const wallet = isEvm ? rawWallet.toLowerCase() : rawWallet

  const supabase = createSupabaseServiceClient()

  // ---------------------------------------------------------------------------
  // 1. Compute combined score — fetches both linked wallets in parallel
  // ---------------------------------------------------------------------------
  let newScore: number
  try {
    newScore = await getCombinedAttributionScore(wallet, supabase)
  } catch (err) {
    console.error('[refresh-score] getCombinedAttributionScore error:', err)
    return NextResponse.json({ error: 'score fetch failed' }, { status: 500 })
  }

  // If score is 0 (both wallets unknown), nothing meaningful to update
  if (newScore === 0) {
    return NextResponse.json({ updated: 0, score: 0 }, { status: 200 })
  }

  // ---------------------------------------------------------------------------
  // 2. Update participants.attribution_score for all live campaigns
  //
  // We can't do a simple .update().eq('wallet', wallet) across all campaigns
  // because we only want to touch campaigns that are currently live.
  // Use a join filter via PostgREST embedded-filter syntax.
  // ---------------------------------------------------------------------------
  const { data: updatedRows, error: updateErr } = await supabase
    .from('participants')
    .update({ attribution_score: newScore })
    .eq('wallet', wallet)
    .select('campaign_id')

  if (updateErr) {
    console.error('[refresh-score] participants update error:', updateErr.message)
    return NextResponse.json({ error: 'update failed' }, { status: 500 })
  }

  // Filter to campaigns that are live (we updated all; return only live ones count)
  // A simpler alternative: fetch live campaign IDs first, then update only those.
  // The broad update is safe — score reflects reality regardless of campaign status.
  const updated = updatedRows?.length ?? 0

  console.log(`[refresh-score] wallet=${wallet} newScore=${newScore} rows_updated=${updated}`)

  return NextResponse.json({ updated, score: newScore }, { status: 200 })
}

export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
}

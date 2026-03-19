// =============================================================================
// GET /api/cron/pool-settle
//
// Token pool reward settlement cron. Runs every 15 minutes.
// Promotes claimable pending_rewards into Merkle distributions so users
// can call MintwareDistributor.claim() once the lock period expires.
//
// vercel.json schedule: "*/15 * * * *"
//
// Authorization: Bearer <CRON_SECRET> (same secret as bridge-verify)
//
// Per-campaign flow:
//   1. Auto-promote locked → claimable (claimable_at <= now)
//   2. Group claimable pending_rewards by campaign
//   3. Sum amount_wei per wallet (buyer + referrer; treasury gets platform_fee leaf)
//   4. Build StandardMerkleTree → write distributions + daily_payouts
//   5. Sign oracle sig via publishDistribution() (zero gas)
//   6. Auto-claim treasury fee leaf (platform_fee rows → MINTWARE_TREASURY_ADDRESS)
//   7. Mark pending_rewards rows as 'claimed'
//
// Idempotent: rows are only settled once. Deferred rows (unresolvable price,
// missing treasury address) stay 'claimable' and are retried on the next run.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { settleTokenPoolBatch } from '@/lib/campaigns/poolSettler'

export const maxDuration = 300   // 5 min — Vercel Pro cron max

export async function GET(req: NextRequest) {
  // Authorization
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'CRON_SECRET not set — refusing to run in production without auth' },
      { status: 500 }
    )
  }

  const startedAt = Date.now()
  console.log('[pool-settle] cron started at', new Date().toISOString())

  try {
    const report = await settleTokenPoolBatch()

    const durationMs = Date.now() - startedAt
    console.log(
      `[pool-settle] complete: ${report.campaigns_settled} settled, ` +
      `${report.campaigns_skipped} skipped, ` +
      `${report.rewards_settled} reward rows settled, ${durationMs}ms`
    )

    return NextResponse.json({
      ok: report.campaigns_skipped === 0,
      ...report,
      duration_ms: durationMs,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[pool-settle] fatal error:', message)
    return NextResponse.json(
      { ok: false, error: message, duration_ms: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function POST() {
  return NextResponse.json({ error: 'method not allowed — use GET' }, { status: 405 })
}

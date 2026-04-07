// =============================================================================
// GET /api/cron/pool-settle
//
// Token pool reward settlement cron. Runs every 15 minutes.
// Promotes claimable pending_rewards into Merkle distributions so users
// can call MintwareDistributor.claim() once the lock period expires.
//
// vercel.json schedule: "*/15 * * * *"
// Authorization: Bearer <CRON_SECRET>
//
// Per-campaign flow:
//   1. Auto-promote locked → claimable (claimable_at <= now)
//   2. Group claimable pending_rewards by campaign
//   3. Sum amount_wei per wallet (buyer + referrer; treasury gets platform_fee leaf)
//   4. Build StandardMerkleTree → write distributions + daily_payouts
//   5. Sign oracle sig via publishDistribution() (zero gas)
//   6. Auto-claim treasury fee leaf
//   7. Mark pending_rewards rows as 'claimed'
//
// Idempotent: rows only settled once. Deferred rows stay 'claimable' and
// are retried on the next run.
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'
import { settleTokenPoolBatch } from '@/lib/rewards/poolSettler'

export const maxDuration = 300  // 5 min — Vercel Pro cron max

export const GET = createHandler(async (_req, ctx) => {
  const startedAt = Date.now()
  ctx.log.info('pool-settle', 'Cron started')

  const report = await settleTokenPoolBatch()
  const duration_ms = Date.now() - startedAt

  ctx.log.info('pool-settle', 'Cron complete', {
    campaigns_settled: report.campaigns_settled,
    campaigns_skipped: report.campaigns_skipped,
    rewards_settled:   report.rewards_settled,
    duration_ms,
  })

  return ctx.json({ ok: report.campaigns_skipped === 0, ...report, duration_ms })
}, { auth: 'bearer-token' })

// =============================================================================
// GET /api/treasury/normalize-mev  (also accepts POST for manual runs)
//
// Triggered daily by Vercel Cron (03:00 UTC) via GET.
//
// Flow:
//   1. Read staged MEV balances in the treasury wallet
//   2. Swap non-USDC assets into USDC using LI.FI
//   3. Deposit resulting USDC into FeeVault via receiveFees("mev-normalized")
//
// Auth: Bearer token matching CRON_SECRET env var.
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'
import { runNormalizeMev } from '@/lib/rewards/treasury/sweep'

export const maxDuration = 300

const handler = createHandler(async (_req, ctx) => {
  ctx.log.info('normalize-mev', 'Starting MEV normalization')
  const report = await runNormalizeMev()
  ctx.log.info('normalize-mev', 'Normalization complete', {
    tokensNormalized:    report.tokensNormalized,
    tokensChecked:       report.tokensChecked,
    totalUsdcDeposited:  report.totalUsdcDeposited,
  })
  return ctx.json({ ok: true, report })
}, { auth: 'bearer-token' })

// Vercel crons invoke via GET — manual calls may use POST
export const GET  = handler
export const POST = handler

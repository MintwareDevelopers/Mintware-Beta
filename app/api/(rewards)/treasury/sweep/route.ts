// =============================================================================
// GET /api/treasury/sweep  (also accepts POST for manual runs)
//
// Triggered daily by Vercel Cron (03:00 UTC) via GET.
// Also callable manually: POST with Authorization header.
//
// Sweeps all accumulated ERC-20 tokens in the Mintware treasury wallet
// into native ETH on Base using LI.FI routing. Skips dust (< $1 USD).
//
// Auth: Bearer token matching CRON_SECRET env var.
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'
import { runSweep } from '@/lib/rewards/treasury/sweep'

export const maxDuration = 300  // 5 min — Vercel Pro allows up to 300s for cron functions

const handler = createHandler(async (_req, ctx) => {
  ctx.log.info('treasury-sweep', 'Starting treasury sweep')
  const report = await runSweep()
  ctx.log.info('treasury-sweep', 'Sweep complete', {
    tokensSwapped: report.tokensSwapped,
    tokensChecked: report.tokensChecked,
  })
  return ctx.json({ ok: true, report })
}, { auth: 'bearer-token' })

// Vercel crons invoke via GET — manual calls may use POST
export const GET  = handler
export const POST = handler

// =============================================================================
// GET /api/cron/bridge-verify
//
// Daily bridge verification cron job.
// Triggered by Vercel Cron at 00:00 UTC — configured in vercel.json:
//   { "path": "/api/cron/bridge-verify", "schedule": "0 0 * * *" }
//
// Vercel Cron sends GET with Authorization: Bearer <CRON_SECRET>.
// Can also be triggered manually with the same header.
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'
import { runBridgeVerifier } from '@/lib/rewards/bridgeVerifier'

export const maxDuration = 300  // 5 min — Vercel Pro max for cron functions

export const GET = createHandler(async (_req, ctx) => {
  const startedAt = Date.now()
  ctx.log.info('bridge-verify', 'Cron started')

  const summary = await runBridgeVerifier()
  const duration_ms = Date.now() - startedAt

  ctx.log.info('bridge-verify', 'Cron complete', { ...summary, duration_ms })
  return ctx.json({ ok: true, duration_ms, ...summary })
}, { auth: 'bearer-token' })

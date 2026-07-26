// GET /api/cron/expire-proposals
//
// Marks past-validUntil rebalance proposals as 'expired'.
// Safe to re-run — idempotent.
//
// vercel.json schedule: "0 * * * *"
// Authorization: Bearer <CRON_SECRET>

import { createHandler } from '@/lib/web2/routeHandler'

export const dynamic = 'force-dynamic'

export const GET = createHandler(async (_req, ctx) => {
  const nowSecs = Math.floor(Date.now() / 1000)

  const { error, count } = await ctx.supabase
    .from('vault_rebalance_proposals')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('valid_until', nowSecs)

  if (error) {
    ctx.log.error('expire-proposals', 'Supabase error', { error: error.message })
    return ctx.json({ success: false, error: 'Failed to expire proposals' }, 500)
  }

  const expired = count ?? 0
  ctx.log.info('expire-proposals', 'Proposals expired', { expired })
  return ctx.json({ expired })
}, { auth: 'bearer-token' })

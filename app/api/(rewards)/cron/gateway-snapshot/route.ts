import { createHandler } from '@/lib/web2/routeHandler'
import { snapshotAll } from '@/lib/gateway/snapshot'

export const dynamic = 'force-dynamic'

// Snapshot every active gateway's depositor positions (value / cost basis / signed PnL) into the
// time-series table — historical PnL/APR (Krystal item 8). Read-only + observability; no money moves.
// No-ops (200) until the gateway chain config is set. Bearer-auth cron.
export const POST = createHandler(
  async (_req, ctx) => {
    const res = await snapshotAll({ supabase: ctx.supabase, log: ctx.log })
    return ctx.json({ success: true, ...res })
  },
  { auth: 'bearer-token' },
)

export const GET = POST

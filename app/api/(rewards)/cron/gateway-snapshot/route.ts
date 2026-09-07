import { createHandler } from '@/lib/web2/routeHandler'
import { snapshotAll } from '@/lib/gateway/snapshot'
import { syncRangeAlerts } from '@/lib/gateway/alerts'

export const dynamic = 'force-dynamic'

// Snapshot every active gateway's depositor positions (value / cost basis / signed PnL) into the
// time-series table — historical PnL/APR (Krystal item 8) — and sync debounced out-of-range alerts
// (item 11). Read-only + observability; no money moves. No-ops (200) until the chain config is set.
export const POST = createHandler(
  async (_req, ctx) => {
    const res = await snapshotAll({ supabase: ctx.supabase, log: ctx.log })
    const alerts = await syncRangeAlerts({ supabase: ctx.supabase, log: ctx.log })
    return ctx.json({ success: true, ...res, alerts })
  },
  { auth: 'bearer-token' },
)

export const GET = POST

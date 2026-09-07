import { createHandler } from '@/lib/web2/routeHandler'
import { snapshotAll } from '@/lib/gateway/snapshot'
import { syncRangeAlerts } from '@/lib/gateway/alerts'
import { runCircuitBreaker } from '@/lib/gateway/circuitBreaker'

export const dynamic = 'force-dynamic'

// Per active gateway: snapshot depositor positions (value / cost basis / signed PnL — item 8), sync
// debounced out-of-range alerts (item 11), then run the circuit breaker (item 13 — auto-pause deposits
// on a firing alert, OFF by default). Snapshots/alerts are read-only; the breaker only flips the on-chain
// paused flag when enabled. No-ops (200) until the chain config is set.
export const POST = createHandler(
  async (_req, ctx) => {
    const res = await snapshotAll({ supabase: ctx.supabase, log: ctx.log })
    const alerts = await syncRangeAlerts({ supabase: ctx.supabase, log: ctx.log })
    const breaker = await runCircuitBreaker({ supabase: ctx.supabase, log: ctx.log })
    return ctx.json({ success: true, ...res, alerts, breaker })
  },
  { auth: 'bearer-token' },
)

export const GET = POST

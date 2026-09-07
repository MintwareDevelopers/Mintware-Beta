import { createHandler } from '@/lib/web2/routeHandler'
import { harvestAll } from '@/lib/gateway/harvest'

export const dynamic = 'force-dynamic'

// Harvest EVERY active gateway's pool fees → yield-first spend buffers. Fail-closed + OFF by default
// (LP_GATEWAY_HARVEST_ENABLED). Idempotent on each collect tx.
export const POST = createHandler(
  async (_req, ctx) => {
    const res = await harvestAll({ supabase: ctx.supabase, log: ctx.log })
    return ctx.json({ success: true, ...res })
  },
  { auth: 'bearer-token' },
)

export const GET = POST

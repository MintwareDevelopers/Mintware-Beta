import { createHandler } from '@/lib/web2/routeHandler'
import { harvestGateway } from '@/lib/gateway/harvest'

export const dynamic = 'force-dynamic'

// Harvest the LP-gateway pool fees → yield-first spend buffer. Fail-closed + OFF by default
// (LP_GATEWAY_HARVEST_ENABLED). Idempotent on the collect tx.
export const POST = createHandler(
  async (_req, ctx) => {
    const res = await harvestGateway({ supabase: ctx.supabase, log: ctx.log })
    return ctx.json(res, res.ok ? 200 : res.status)
  },
  { auth: 'bearer-token' },
)

export const GET = POST

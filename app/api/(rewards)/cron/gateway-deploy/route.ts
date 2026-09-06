import { createHandler } from '@/lib/web2/routeHandler'
import { deployAll } from '@/lib/gateway/deploy'

export const dynamic = 'force-dynamic'

// Move staged (Morpho-earning) capital into each active gateway's pool once its threshold is hit.
// Fail-closed + OFF by default (LP_GATEWAY_DEPLOY_ENABLED); also no-ops while the zap seam is unwired.
export const POST = createHandler(
  async (_req, ctx) => {
    const res = await deployAll({ supabase: ctx.supabase, log: ctx.log })
    return ctx.json({ success: true, ...res })
  },
  { auth: 'bearer-token' },
)

export const GET = POST

import { createHandler } from '@/lib/web2/routeHandler'
import { deployGateway } from '@/lib/gateway/deploy'

export const dynamic = 'force-dynamic'

// Move staged (Morpho-earning) capital into the target V4 pool once a threshold is hit. Fail-closed +
// OFF by default (LP_GATEWAY_DEPLOY_ENABLED); also no-ops while the paired-leg zap seam is unwired.
export const POST = createHandler(
  async (_req, ctx) => {
    const res = await deployGateway({ supabase: ctx.supabase, log: ctx.log })
    return ctx.json(res, res.ok ? 200 : res.status)
  },
  { auth: 'bearer-token' },
)

export const GET = POST

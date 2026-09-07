import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayConfig } from '@/lib/gateway/chain'
import { resolveRouteInstance } from '@/lib/gateway/registry'

export const dynamic = 'force-dynamic'

// Public: the on-chain coordinates a client needs to deposit into a pool's gateway — the position
// manager (deposit target), chain id + RPC (to submit on the right network), and the USDG address (the
// token to approve). Resolves the live instance for `pool`; 503 until a gateway is configured/deployed.
export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const inst = await resolveRouteInstance(ctx.supabase, cfg, req.nextUrl.searchParams.get('pool'))
  if (!inst) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  return ctx.json({
    success: true,
    meta: {
      positionManager: inst.positionManager,
      poolAddress: inst.poolAddress,
      chainId: inst.chainId,
      rpcUrl: cfg.rpcUrl,
      usdg: process.env.LP_GATEWAY_USDG ?? null,
      live: true,
    },
  })
})

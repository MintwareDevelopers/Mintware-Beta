import { createHandler } from '@/lib/web2/routeHandler'
import { listMarketEngines, marketEngineConfig } from '@/lib/gateway/marketEngine'

export const dynamic = 'force-dynamic'
export const GET = createHandler(async (req, ctx) => {
  const cfg = marketEngineConfig()
  if (!cfg) return ctx.json({ success: true, instances: [] })
  const requested = req.nextUrl.searchParams.get('chainId')
  const chainId = requested ? Number(requested) : cfg.chainId
  let instances
  try { instances = await listMarketEngines(ctx.supabase, chainId, req.nextUrl.searchParams.get('all') !== '1') }
  catch (e) {
    ctx.log.warn('market-engine.instances', 'engine registry unavailable', { error: String(e) })
    return ctx.json({ success: false, error: 'engine_registry_unavailable' }, 503)
  }
  return ctx.json({ success: true, instances: instances.map((x) => ({ ...x, positionManager: x.engineAddress, verification: x.verified ? 'codehash' : null })) })
})

// GET /api/pools — Mintware's liquidity manifest for solver/aggregator networks (UniswapX, CoW, 1inch
// Fusion) and indexers. CORS-open so external routers can ingest it. Config-driven (MINTWARE_POOLS_JSON):
// empty + honest until operators populate real PoolKeys post-deploy. Spec: distribution / solver-visibility.

import { createHandler } from '@/lib/web2/routeHandler'
import { buildManifest, getConfiguredPools } from '@/lib/pools/manifest'

export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=30',
}

export const GET = createHandler(async (_req, ctx) => {
  const manifest = buildManifest(getConfiguredPools())
  const res = ctx.json(manifest)
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v)
  return res
})

export const OPTIONS = createHandler(async (_req, ctx) => {
  const res = ctx.json({}, 204)
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v)
  return res
})

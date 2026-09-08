import { createHandler } from '@/lib/web2/routeHandler'
import { listActiveInstances, listAllInstances } from '@/lib/gateway/registry'

export const dynamic = 'force-dynamic'

// Public: every live curated gateway (one per pool). Powers the /earn discovery list + is the set the
// harvest/deploy crons iterate. `?all=1` also returns deactivated rows (with `status`) — the curator
// view needs them (withdraw-only pools; audit closeout O-3 / HO-7). Addresses only — nothing secret.
export const GET = createHandler(async (req, ctx) => {
  const c = req.nextUrl.searchParams.get('chainId')
  const all = req.nextUrl.searchParams.get('all') === '1'
  const chainId = c ? Number(c) : undefined
  const instances = all ? await listAllInstances(ctx.supabase, chainId) : await listActiveInstances(ctx.supabase, chainId)
  return ctx.json({ success: true, instances })
})

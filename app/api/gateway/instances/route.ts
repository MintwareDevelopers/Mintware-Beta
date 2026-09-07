import { createHandler } from '@/lib/web2/routeHandler'
import { listActiveInstances } from '@/lib/gateway/registry'

export const dynamic = 'force-dynamic'

// Public: every live curated gateway (one per pool). Powers the /earn discovery list + is the set the
// harvest/deploy crons iterate.
export const GET = createHandler(async (req, ctx) => {
  const c = req.nextUrl.searchParams.get('chainId')
  const instances = await listActiveInstances(ctx.supabase, c ? Number(c) : undefined)
  return ctx.json({ success: true, instances })
})

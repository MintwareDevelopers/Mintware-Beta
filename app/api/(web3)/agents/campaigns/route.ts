// GET /api/agents/campaigns        — list all agent volume campaigns
// GET /api/agents/campaigns?active=true — filter to active only
// Auth: none

import { createHandler } from '@/lib/web2/routeHandler'

export const GET = createHandler(async (req, ctx) => {
  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'

  let q = ctx.supabase.from('ai_volume_campaigns').select('*').order('created_at', { ascending: false })
  if (activeOnly) q = q.eq('active', true)

  const { data, error } = await q
  if (error) {
    ctx.log.error('agents/campaigns', 'failed to load campaigns', { error: error.message })
    return ctx.json({ error: 'failed to load campaigns' }, 500)
  }

  const res = ctx.json({ campaigns: data ?? [], total: data?.length ?? 0 })
  res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  return res
})

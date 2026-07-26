// GET /api/vaults               — list all vaults (public)
// GET /api/vaults?status=active — filter by status
// Auth: none

import { createHandler } from '@/lib/web2/routeHandler'

export const GET = createHandler(async (req, ctx) => {
  const status = req.nextUrl.searchParams.get('status')

  let q = ctx.supabase
    .from('social_vaults')
    .select(`*, current_epoch:vault_epochs(id, epoch_number, total_pool, bonus_pool, status, opened_at, closed_at, deadline)`)
    .order('created_at', { ascending: false })

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) {
    ctx.log.error('vaults', 'Failed to load vaults', { error: error.message })
    return ctx.json({ error: 'Failed to load vaults' }, 500)
  }

  const res = ctx.json(data ?? [])
  res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  return res
})

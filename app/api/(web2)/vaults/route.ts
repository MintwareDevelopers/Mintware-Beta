// GET /api/vaults               — list all vaults (public)
// GET /api/vaults?status=active — filter by status
// Auth: none

import { createHandler } from '@/lib/web2/routeHandler'

export const GET = createHandler(async (req, ctx) => {
  const status = req.nextUrl.searchParams.get('status')

  let q = ctx.supabase
    .from('social_vaults')
    .select(`*, current_epoch:vault_epochs(id, epoch_number, total_pool, bonus_pool, status, opened_at, closed_at, deadline)`)
    .neq('surface', 'rwa') // DeFi vault list only — RWA vaults render via their deal pages
    .order('created_at', { ascending: false })

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) {
    ctx.log.error('vaults', 'Failed to load vaults', { error: error.message })
    return ctx.json({ error: 'Failed to load vaults' }, 500)
  }

  // vault_epochs is a to-many join → collapse `current_epoch` to the single
  // active (or latest) epoch so the shape matches SocialVault.current_epoch.
  const rows = (data ?? []).map((v: Record<string, unknown>) => ({
    ...v,
    current_epoch: pickEpoch(v.current_epoch),
  }))

  const res = ctx.json(rows)
  res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  return res
})

function pickEpoch(e: unknown) {
  if (!Array.isArray(e)) return e ?? null
  return e.find((x) => x?.status === 'active') ?? e[0] ?? null
}

// GET /api/vaults                — DeFi vault list (default, back-compat)
// GET /api/vaults?status=active  — filter by status
// GET /api/vaults?surface=all    — both surfaces (DeFi + RWA), each row carries `surface`
// GET /api/vaults?surface=rwa    — RWA vaults only
// Auth: none

import { createHandler } from '@/lib/web2/routeHandler'

export const GET = createHandler(async (req, ctx) => {
  const status  = req.nextUrl.searchParams.get('status')
  const surface = req.nextUrl.searchParams.get('surface')  // 'all' | 'defi' | 'rwa' | null

  let q = ctx.supabase
    .from('social_vaults')
    .select(`*, current_epoch:vault_epochs(id, epoch_number, total_pool, bonus_pool, status, opened_at, closed_at, deadline)`)
    .order('created_at', { ascending: false })

  // Surface scope: 'all' → both; 'rwa' → RWA only; default/'defi' → DeFi only (back-compat).
  if (surface === 'rwa') q = q.eq('surface', 'rwa')
  else if (surface !== 'all') q = q.neq('surface', 'rwa')

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

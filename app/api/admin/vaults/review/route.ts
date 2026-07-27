// GET /api/admin/vaults/review — pending items for the RWA review queue.
// Admin-gated (verifyAdmin). Returns REGISTERED issuers + in_review deals (with
// vault name + documents).

import { createHandler } from '@/lib/web2/routeHandler'
import { verifyAdmin } from '@/lib/web2/admin'

export const GET = createHandler(async (req, ctx) => {
  const admin = await verifyAdmin(req)
  if (!admin) return ctx.json({ error: 'unauthorized' }, 401)

  const [issuersRes, dealsRes] = await Promise.all([
    ctx.supabase.from('vault_issuers').select('*').eq('status', 'REGISTERED').order('created_at', { ascending: true }),
    ctx.supabase
      .from('vault_deals')
      .select('*, social_vaults(name), vault_deal_documents(*)')
      .eq('review_status', 'in_review')
      .order('created_at', { ascending: true }),
  ])

  if (issuersRes.error || dealsRes.error) {
    ctx.log.error('admin/review', 'load failed', { i: issuersRes.error?.message, d: dealsRes.error?.message })
    return ctx.json({ error: 'Failed to load review queue' }, 500)
  }

  return ctx.json({
    pendingIssuers: issuersRes.data ?? [],
    pendingDeals: dealsRes.data ?? [],
  })
})

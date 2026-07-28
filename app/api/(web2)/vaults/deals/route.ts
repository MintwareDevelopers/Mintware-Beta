// =============================================================================
// GET /api/vaults/deals
//
// Public list of APPROVED RWA deals, for the campaign creator's surface picker
// (RWA Incentive Layer · R1). Returns the vault_deals.id a campaign links to,
// plus the vault name + settle_days that seeds the duration-match default.
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'

export const GET = createHandler(async (_req, ctx) => {
  const { data, error } = await ctx.supabase
    .from('vault_deals')
    .select('id, target_apy_pct, settle_days, underlying_asset_class, social_vaults(id, name, status)')
    .eq('review_status', 'approved')

  if (error) {
    ctx.log.warn('vaults/deals', 'query failed', { error: error.message })
    return ctx.json({ deals: [] })
  }

  const deals = (data ?? []).flatMap((d: Record<string, unknown>) => {
    const v = d.social_vaults as { id?: string; name?: string; status?: string } | null
    if (!v?.id) return []
    return [{
      dealId:     String(d.id),
      vaultId:    v.id,
      name:       v.name ?? 'RWA Deal',
      asset:      (d.underlying_asset_class as string) ?? 'RWA',
      apyPct:     d.target_apy_pct != null ? Number(d.target_apy_pct) : null,
      settleDays: Number(d.settle_days ?? 30),
      status:     v.status ?? 'active',
    }]
  })

  return ctx.json({ deals })
}, { auth: 'none' })

// =============================================================================
// POST /api/orgs
//
// Create a tenant org. Flat — no treasury deploy happens here (see migration
// header for why; treasury_vault_address is set manually by an operator after
// a real `forge script ... --broadcast` run). Owner = the authenticated wallet.
//
// Body: { authMessage, authSignature, issuedAt, address, name, slug }
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'

function isValidSlug(raw: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/.test(raw)
}

export const POST = createHandler(async (req, ctx) => {
  const body = await req.clone().json().catch(() => null) as Record<string, unknown> | null
  const name = body?.name
  const slug = body?.slug

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return ctx.json({ error: 'name required' }, 400)
  }
  if (!slug || typeof slug !== 'string' || !isValidSlug(slug)) {
    return ctx.json({ error: 'slug must be lowercase alphanumeric + hyphens' }, 400)
  }

  const { data, error } = await ctx.supabase
    .from('orgs')
    .insert({ name: name.trim(), slug, owner_wallet: ctx.user!.address.toLowerCase() })
    .select('id, name, slug, owner_wallet, created_at')
    .single()

  if (error) {
    if (error.code === '23505') return ctx.json({ error: 'slug already taken' }, 409)
    ctx.log.error('orgs', 'Create failed', { error: error.message })
    return ctx.json({ error: 'create failed' }, 500)
  }

  return ctx.json({ org: data })
}, { auth: 'signed-message', action: 'mintware-org-create', rateLimit: { max: 10, windowMs: 60_000 } })

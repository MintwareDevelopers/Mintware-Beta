// GET /api/orgs/mine?address=0x… — the orgs a wallet belongs to (owned + active memberships), for the
// /app/org hub. Public-ish read (org names/slugs/roles, no emails). Keyed by wallet so the hub can list
// "your orgs" without a signed request.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'

export const dynamic = 'force-dynamic'
const EVM_RE = /^0x[a-fA-F0-9]{40}$/

export const GET = createHandler(async (req, ctx) => {
  const address = new URL(req.url).searchParams.get('address')?.toLowerCase()
  if (!address || !EVM_RE.test(address)) return ctx.json({ error: 'valid ?address= required' }, 400)

  // Owned orgs.
  const { data: owned } = await ctx.supabase
    .from('orgs')
    .select('id, name, slug, treasury_vault_address')
    .eq('owner_wallet', address)

  // Active memberships → the orgs behind them.
  const { data: memberships } = await ctx.supabase
    .from('org_members')
    .select('role, org_id, orgs!inner(id, name, slug, treasury_vault_address)')
    .eq('wallet', address)
    .eq('status', 'active')

  const byId = new Map<string, { id: string; name: string; slug: string; role: string; isOwner: boolean; funded: boolean }>()
  for (const o of owned ?? []) {
    byId.set(o.id, { id: o.id, name: o.name, slug: o.slug, role: 'owner', isOwner: true, funded: !!o.treasury_vault_address })
  }
  for (const m of memberships ?? []) {
    // supabase embeds the joined row as an object under the relationship name
    const o = (m as unknown as { orgs: { id: string; name: string; slug: string; treasury_vault_address: string | null } }).orgs
    if (!o || byId.has(o.id)) continue
    byId.set(o.id, { id: o.id, name: o.name, slug: o.slug, role: (m.role as string) ?? 'contributor', isOwner: false, funded: !!o.treasury_vault_address })
  }

  return ctx.json({ orgs: Array.from(byId.values()) })
})

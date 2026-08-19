// Org roster (#3 roles UI + #5 payroll targets). GET = owner-only roster; PATCH = owner sets a member's
// role preset (free-text role on org_members — the org layer already allows any string). Invite/accept
// stay in the org layer's own routes; this only reads the roster and re-assigns a preset.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { ROLE_PRESETS, type RolePreset } from '@/lib/org/rolePresets'

export const dynamic = 'force-dynamic'

async function assertOwner(ctx: { supabase: import('@supabase/supabase-js').SupabaseClient; user?: { address: string } }, id: string) {
  const { data: org } = await ctx.supabase.from('orgs').select('id, owner_wallet').eq('id', id).single()
  if (!org) return { ok: false as const, code: 404, msg: 'org not found' }
  if (org.owner_wallet.toLowerCase() !== ctx.user!.address.toLowerCase()) return { ok: false as const, code: 403, msg: 'only the org owner can manage members' }
  return { ok: true as const, org }
}

// Roster read is a POST (not GET) because signed-message auth carries its proof in the request body, and
// a GET cannot. Owner-only — the roster includes invite emails.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (_r, ctx) => {
      const gate = await assertOwner(ctx, id)
      if (!gate.ok) return ctx.json({ error: gate.msg }, gate.code)
      const { data } = await ctx.supabase
        .from('org_members')
        .select('id, invited_email, wallet, role, status, eas_uid, invited_at, accepted_at')
        .eq('org_id', id)
        .order('invited_at', { ascending: true })
      return ctx.json({ members: data ?? [] })
    },
    { auth: 'signed-message', action: 'mintware-org-members' },
  )(req)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (r, ctx) => {
      const gate = await assertOwner(ctx, id)
      if (!gate.ok) return ctx.json({ error: gate.msg }, gate.code)
      const body = await r.clone().json().catch(() => ({}))
      const memberId = String(body.memberId ?? '')
      const role = String(body.role ?? '').toLowerCase() as RolePreset
      if (!memberId) return ctx.json({ error: 'memberId required' }, 400)
      if (!ROLE_PRESETS[role]) return ctx.json({ error: 'role must be one of: owner, manager, contributor, vendor' }, 400)
      const { error } = await ctx.supabase.from('org_members').update({ role }).eq('id', memberId).eq('org_id', id)
      if (error) return ctx.json({ error: 'update failed' }, 500)
      return ctx.json({ ok: true, memberId, role })
    },
    { auth: 'signed-message', action: 'mintware-org-members' },
  )(req)
}

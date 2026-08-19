// =============================================================================
// POST /api/orgs/[id]/invite
//
// Invite a teammate by email. No wallet exists yet — that's resolved when
// they log in via Privy and call POST /api/orgs/accept, which issues the
// OrgMembership attestation. Only the org's owner_wallet may invite (v1: flat
// ownership, no admin-role delegation yet).
//
// Body: { authMessage, authSignature, issuedAt, address, email, role? }
// =============================================================================

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orgId } = await params

  return createHandler(async (req2, ctx) => {
    const body  = await req2.clone().json().catch(() => null) as Record<string, unknown> | null
    const email = body?.email
    const role  = (body?.role as string | undefined)?.trim() || 'contributor'

    if (!email || typeof email !== 'string' || !isValidEmail(email)) {
      return ctx.json({ error: 'valid email required' }, 400)
    }

    const { data: org, error: orgErr } = await ctx.supabase
      .from('orgs')
      .select('id, owner_wallet')
      .eq('id', orgId)
      .maybeSingle()

    if (orgErr || !org) return ctx.json({ error: 'org not found' }, 404)
    if (org.owner_wallet !== ctx.user!.address.toLowerCase()) {
      return ctx.json({ error: 'only the org owner can invite' }, 403)
    }

    const { data, error } = await ctx.supabase
      .from('org_members')
      .insert({ org_id: orgId, invited_email: email.toLowerCase(), role })
      .select('id, invited_email, role, status, invited_at')
      .single()

    if (error) {
      if (error.code === '23505') return ctx.json({ error: 'already invited' }, 409)
      ctx.log.error('orgs-invite', 'Insert failed', { error: error.message })
      return ctx.json({ error: 'invite failed' }, 500)
    }

    return ctx.json({ invite: data })
  }, { auth: 'signed-message', action: 'mintware-org-invite', rateLimit: { max: 30, windowMs: 60_000 } })(req)
}

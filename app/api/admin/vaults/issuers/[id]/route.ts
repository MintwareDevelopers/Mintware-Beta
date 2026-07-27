// POST /api/admin/vaults/issuers/[id] — set an issuer's status.
// Body: { status: 'VERIFIED' | 'SUSPENDED' | 'REGISTERED' }. Admin-gated.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { verifyAdmin } from '@/lib/web2/admin'

const STATUSES = ['VERIFIED', 'SUSPENDED', 'REGISTERED']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(async (r, ctx) => {
    const admin = await verifyAdmin(r)
    if (!admin) return ctx.json({ error: 'unauthorized' }, 401)

    const body = await r.clone().json().catch(() => ({}))
    const status = (body as { status?: string }).status
    if (!status || !STATUSES.includes(status)) return ctx.json({ error: 'invalid status' }, 400)

    const { error } = await ctx.supabase.from('vault_issuers').update({ status }).eq('id', id)
    if (error) {
      ctx.log.error('admin/issuers', 'update failed', { id, error: error.message })
      return ctx.json({ error: 'update failed' }, 500)
    }
    ctx.log.info('admin/issuers', 'status set', { id, status, admin })
    return ctx.json({ ok: true, id, status })
  })(req)
}

// POST /api/admin/vaults/redemptions/[id] — advance a redemption's settlement.
// Body: { status: 'ready' | 'settled', kyc_verified?: boolean, tx_hash?: string }.
// Mirrors the issuer's confirmSettlement (KYC-gated) off-chain. Admin-gated.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { verifyAdmin } from '@/lib/web2/admin'

const STATUSES = ['pending', 'ready', 'settled']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(async (r, ctx) => {
    const admin = await verifyAdmin(r)
    if (!admin) return ctx.json({ error: 'unauthorized' }, 401)

    const body = (await r.clone().json().catch(() => ({}))) as { status?: string; kyc_verified?: boolean; tx_hash?: string }
    if (!body.status || !STATUSES.includes(body.status)) return ctx.json({ error: 'invalid status' }, 400)

    const patch: Record<string, unknown> = { status: body.status }
    if (typeof body.kyc_verified === 'boolean') patch.kyc_verified = body.kyc_verified
    if (body.tx_hash) patch.tx_hash = body.tx_hash

    const { error } = await ctx.supabase.from('vault_redemptions').update(patch).eq('id', id)
    if (error) {
      ctx.log.error('admin/redemptions', 'update failed', { id, error: error.message })
      return ctx.json({ error: 'update failed' }, 500)
    }
    ctx.log.info('admin/redemptions', 'settled', { id, status: body.status, admin })
    return ctx.json({ ok: true, id, status: body.status })
  })(req)
}

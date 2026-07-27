// POST /api/admin/vaults/deals/[id] — approve or reject a deal (+ its documents).
// Body: { action: 'approve' | 'reject', note?: string }. Admin-gated.
// On approve, all of the deal's documents are marked approved.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { verifyAdmin } from '@/lib/web2/admin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(async (r, ctx) => {
    const admin = await verifyAdmin(r)
    if (!admin) return ctx.json({ error: 'unauthorized' }, 401)

    const body = (await r.clone().json().catch(() => ({}))) as { action?: string; note?: string }
    if (body.action !== 'approve' && body.action !== 'reject')
      return ctx.json({ error: 'action must be approve or reject' }, 400)

    const review_status = body.action === 'approve' ? 'approved' : 'rejected'
    const { error } = await ctx.supabase
      .from('vault_deals')
      .update({ review_status, review_note: body.note ?? null })
      .eq('id', id)
    if (error) {
      ctx.log.error('admin/deals', 'update failed', { id, error: error.message })
      return ctx.json({ error: 'update failed' }, 500)
    }

    // Approving the deal approves its data-room documents in one step.
    if (body.action === 'approve') {
      await ctx.supabase.from('vault_deal_documents').update({ review_status: 'approved' }).eq('deal_id', id)
    }

    ctx.log.info('admin/deals', 'reviewed', { id, review_status, admin })
    return ctx.json({ ok: true, id, review_status })
  })(req)
}

// GET /api/vaults/[id]/deal — public RWA deal for a vault (APPROVED only).
// Returns { deal: DealMeta | null }. Unapproved deals are never exposed publicly.
// Auth: none.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(async (_req, ctx) => {
    try {
      const { dbGetDeal } = await import('@/lib/rwa/db')
      const deal = await dbGetDeal(id)
      if (!deal || deal.reviewStatus !== 'approved') return ctx.json({ deal: null })
      return ctx.json({ deal })
    } catch {
      return ctx.json({ deal: null })
    }
  })(req)
}

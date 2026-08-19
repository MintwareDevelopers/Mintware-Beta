// Spend feed — recent card_swipe_events for the org, written only by the ASA webhook (and updated
// by the settle route once a settlement lands on-chain). POST not GET — signed-message auth needs a
// body (see cards/route.ts header). Read-only, any active member.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { requireActiveCaller } from '@/lib/org/requireActiveCaller'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (_r, ctx) => {
      const auth = await requireActiveCaller(ctx.supabase, ctx.user!.address, id)
      if ('error' in auth) return ctx.json({ error: auth.error }, auth.status)

      const { data, error } = await ctx.supabase
        .from('card_swipe_events')
        .select('id, org_card_id, member_wallet, amount_atomic_usdc, merchant_descriptor, decision, decline_reason, edge_hold_id, latency_ms, settled, settle_tx, created_at')
        .eq('org_id', id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) return ctx.json({ error: 'query_failed' }, 500)
      return ctx.json({ events: data ?? [] })
    },
    { auth: 'signed-message', action: 'mintware-org-cards-events' },
  )(req)
}

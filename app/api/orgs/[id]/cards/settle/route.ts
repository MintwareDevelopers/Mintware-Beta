// Settle an approved swipe on demand — the owner-clicked "Settle" button. It authorizes the caller
// (owner-only; moves real on-chain funds even on testnet) and then delegates to the SHARED settle
// core (lib/org/settleSwipe.ts) — the exact settleSpend() call proven live (lib/proof/latestRun.ts
// leg 3, tx 0x7fd4b3f0…). The capture webhook (app/api/cards/lithic/capture-webhook) runs that same
// core automatically for small swipes; keeping one implementation means the manual and automatic
// paths can never drift.
//
// The submitter is the same oracle/Privy signer in the RELAYER_ROLE seat (getOracleSigner('root')) —
// the established on-demand demo-settlement pattern, NOT a new always-on relayer server. The ≤$250 /
// permit / activation rules all live in the shared core.

import type { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { requireActiveCaller } from '@/lib/org/requireActiveCaller'
import { settleSwipeEvent } from '@/lib/org/settleSwipe'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return createHandler(
    async (r, ctx) => {
      const body = await r.clone().json().catch(() => ({}))
      const eventId = String(body.eventId ?? '')
      if (!eventId) return ctx.json({ error: 'eventId required' }, 400)

      // Owner-only: settlement moves funds. (The webhook path is gated by Lithic signature + the
      // auto-settle valve instead; both converge on the same settleSwipeEvent core below.)
      const auth = await requireActiveCaller(ctx.supabase, ctx.user!.address, id)
      if ('error' in auth) return ctx.json({ error: auth.error }, auth.status)
      if (!auth.policy.canManageTreasury) return ctx.json({ error: 'owner only' }, 403)

      // Manual settle: no auto-cap — the owner may settle anything the core allows (up to the $250
      // gateway boundary), because a human is in the loop.
      const outcome = await settleSwipeEvent({ supabase: ctx.supabase, orgId: id, eventId, log: ctx.log })
      if (!outcome.ok) {
        if (outcome.reason === 'tx') return ctx.json({ ok: false, error: outcome.error, detail: outcome.detail }, outcome.status)
        return ctx.json({ error: outcome.error }, outcome.status)
      }
      return ctx.json({ ok: true, txHash: outcome.txHash, explorerUrl: outcome.explorerUrl })
    },
    { auth: 'signed-message', action: 'mintware-org-card-settle' },
  )(req)
}

import { createHandler } from '@/lib/web2/routeHandler'
import { reconcilePendingSwaps } from '@/lib/gateway/reconcileSwaps'

export const dynamic = 'force-dynamic'

// Re-checks harvest_events rows flagged swap_needs_reconciliation (a real paired-fee conversion swap
// whose proceeds couldn't be measured at harvest time — see routerSwap.ts#measureSwapProceeds and
// lib/gateway/reconcileSwaps.ts's own header for the full design). Never guesses: a re-check that still
// can't measure real proceeds is flagged 'unmeasurable' for manual operator review, not silently retried
// forever; a confirmed revert or a measured net-zero/negative is a definitive resolved outcome; only a
// genuinely measured positive amount triggers a real on-chain compoundQuote() to recover it into NAV.
// Fail-closed + OFF by default: LP_GATEWAY_RECONCILE_ENABLED=true (needs the gateway signer seat).
export const POST = createHandler(
  async (_req, ctx) => {
    const res = await reconcilePendingSwaps({ supabase: ctx.supabase, log: ctx.log })
    return ctx.json({ success: true, ...res })
  },
  { auth: 'bearer-token' },
)

export const GET = POST

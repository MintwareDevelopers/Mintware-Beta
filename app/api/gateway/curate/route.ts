import { createHandler } from '@/lib/web2/routeHandler'
import { registerInstance } from '@/lib/gateway/registry'

export const dynamic = 'force-dynamic'

// Curator-only (bearer). Approve or reject a pool request. Easy curation: one call resolves the queue,
// and an approve that carries the deployed gateway addresses ALSO registers the live instance in one
// shot (operator deploys via the factory, then approves-with-addresses). Fail-closed: the bearer secret
// falls back to an unmatchable literal when LP_GATEWAY_CURATOR_SECRET is unset, so curation is off until
// it's deliberately configured.
export const POST = createHandler(
  async (req, ctx) => {
    const b = (await req.clone().json().catch(() => ({}))) as {
      requestId?: string
      action?: 'approve' | 'reject'
      curator?: string
      curatorNote?: string
      instance?: {
        poolAddress?: string
        chainId?: number
        pairLabel?: string
        positionManager?: string
        staging?: string
        quoteAsset?: string
        pairedAsset?: string
        tickLower?: number
        tickUpper?: number
      }
    }
    if (b.action !== 'approve' && b.action !== 'reject') {
      return ctx.json({ success: false, error: 'action_required' }, 400)
    }

    let request: Record<string, unknown> | null = null
    if (b.requestId) {
      const { data } = await ctx.supabase.from('gateway_pool_requests').select('*').eq('id', b.requestId).maybeSingle()
      if (!data) return ctx.json({ success: false, error: 'request_not_found' }, 404)
      request = data as Record<string, unknown>
    }

    const resolve = async (status: 'approved' | 'rejected') => {
      if (!request) return
      await ctx.supabase
        .from('gateway_pool_requests')
        .update({ status, curator_note: b.curatorNote ?? null, reviewed_by: b.curator ?? null, reviewed_at: new Date().toISOString() })
        .eq('id', String(request.id))
    }

    if (b.action === 'reject') {
      await resolve('rejected')
      return ctx.json({ success: true, action: 'rejected' })
    }

    // approve — register the deployed instance if its addresses were supplied
    let registered = false
    const inst = b.instance
    if (inst?.positionManager && inst.staging && inst.quoteAsset) {
      const chainId = Number(request?.chain_id ?? inst.chainId ?? 0)
      const poolAddress = String(request?.pool_address ?? inst.poolAddress ?? '')
      if (!chainId || !poolAddress) return ctx.json({ success: false, error: 'pool_and_chain_required' }, 400)
      const reg = await registerInstance(ctx.supabase, {
        poolAddress,
        chainId,
        pairLabel: (request?.pair_label as string) ?? inst.pairLabel ?? null,
        positionManager: inst.positionManager,
        staging: inst.staging,
        quoteAsset: inst.quoteAsset,
        pairedAsset: inst.pairedAsset ?? null,
        tickLower: inst.tickLower ?? null,
        tickUpper: inst.tickUpper ?? null,
        createdBy: b.curator ?? null,
      })
      if (!reg.ok) return ctx.json({ success: false, error: 'register_failed', detail: reg.error }, 500)
      registered = true
    }
    await resolve('approved')
    return ctx.json({ success: true, action: 'approved', registered })
  },
  { auth: 'bearer-token', bearerSecret: process.env.LP_GATEWAY_CURATOR_SECRET ?? 'unset-curator-secret-fail-closed' },
)

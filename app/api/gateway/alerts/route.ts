import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayConfig } from '@/lib/gateway/chain'
import { resolveRouteInstance } from '@/lib/gateway/registry'

export const dynamic = 'force-dynamic'

// Public read of OPEN operational alerts for a pool's gateway (Krystal item 11). `firing` = the
// condition has persisted past the debounce window. Powers the in-app out-of-range banner. Returns an
// empty list (never 5xx) when unconfigured, so the UI just shows nothing.
export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: true, alerts: [] })
  const inst = await resolveRouteInstance(ctx.supabase, cfg, req.nextUrl.searchParams.get('pool'))
  if (!inst) return ctx.json({ success: true, alerts: [] })

  const { data } = await ctx.supabase
    .from('gateway_alerts')
    .select('kind, firing, first_seen_at, detail')
    .eq('pool_address', inst.poolAddress).eq('chain_id', inst.chainId)
    .is('resolved_at', null)

  return ctx.json({
    success: true,
    alerts: (data ?? []).map((a: { kind: string; firing: boolean; first_seen_at: string; detail: unknown }) => ({
      kind: a.kind, firing: a.firing, sinceIso: a.first_seen_at, detail: a.detail,
    })),
  })
})

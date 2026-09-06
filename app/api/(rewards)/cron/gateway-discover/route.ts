import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayConfig } from '@/lib/gateway/chain'
import { discoverAndIngest } from '@/lib/gateway/discovery'

export const dynamic = 'force-dynamic'

// Auto-surface the hottest RH-Chain pools → curated candidate queue (pending, human-gated). Never
// auto-approves. No-ops (200) until the gateway chain config is set. Bearer-auth cron.
export const POST = createHandler(
  async (_req, ctx) => {
    const cfg = gatewayConfig()
    if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)
    const res = await discoverAndIngest({ supabase: ctx.supabase, chainId: cfg.chainId, log: ctx.log })
    return ctx.json({ success: true, ...res })
  },
  { auth: 'bearer-token' },
)

export const GET = POST

import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayConfig } from '@/lib/gateway/chain'
import { discoverAndIngest } from '@/lib/gateway/discovery'

export const dynamic = 'force-dynamic'

// Auto-surface the hottest RH-Chain pools → curated candidate queue (pending, human-gated). Never
// auto-approves. No-ops (503) until the gateway chain config is set. Bearer-auth cron.
// Scheduled DAILY at 05:00 UTC (`vercel.json`), not "every 3h" (O-14 #1).
// Survives a hostile/malformed/slow upstream (O-7): `discoverAndIngest` validates the payload shape,
// times out (8 s) with bounded retries, and never throws — a bad run returns `upstream:'error'` with
// zeros rather than a 500, so the queue is left untouched (no prune on a failed read).
export const POST = createHandler(
  async (_req, ctx) => {
    const cfg = gatewayConfig()
    if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)
    const res = await discoverAndIngest({ supabase: ctx.supabase, chainId: cfg.chainId, log: ctx.log })
    if (res.upstream === 'error') ctx.log.warn('gateway.discover', 'upstream read failed — queue untouched', { ...res })
    return ctx.json({ success: true, ...res })
  },
  { auth: 'bearer-token' },
)

export const GET = POST

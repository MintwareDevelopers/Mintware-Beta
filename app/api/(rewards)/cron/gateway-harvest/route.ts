import { createHandler } from '@/lib/web2/routeHandler'
import { harvestAll } from '@/lib/gateway/harvest'

export const dynamic = 'force-dynamic'

// Harvest EVERY active gateway's pool fees, then settle them through the event-indexed ledger
// (lib/gateway/ledger.ts): index every `Harvested` log since the persisted cursor (cron harvests AND
// withdraw/deploy sweeps) → credit by on-chain sharesOf at the harvest block (buffer destination) or
// compound Σ pending net on-chain (restake — the DEFAULT). Fail-closed + OFF by default:
//   LP_GATEWAY_HARVEST_ENABLED=true       → collect + index + settle (needs the gateway signer seat)
//   LP_GATEWAY_LEDGER_INDEX_ENABLED=true  → index-only (no tx, no signer; still records sweeps)
// Idempotent on each collect tx (harvest_events) AND on every (chain, tx, logIndex) (gateway_harvest_logs).
export const POST = createHandler(
  async (_req, ctx) => {
    const res = await harvestAll({ supabase: ctx.supabase, log: ctx.log })
    return ctx.json({ success: true, ...res })
  },
  { auth: 'bearer-token' },
)

export const GET = POST

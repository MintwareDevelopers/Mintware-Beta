import { createHandler } from '@/lib/web2/routeHandler'

/** Retired demo writer. Trading requires the permissioned Universal Router path. */
export const POST = createHandler(async (_req, ctx) => ctx.json({ success: false, error: 'demo_trading_retired' }, 410))

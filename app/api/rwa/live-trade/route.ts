// POST /api/rwa/live-trade — V2-RWAs "run a live trade" button. Executes ONE real Base Sepolia trade from the
// verified demo-trader Privy wallet so a new tx hash appears in the market feed live.
//
// Gates, all fail-closed: the V2-RWAs flag + V2 gate; an EIP-191 signed-message bound to this action; the
// signer must be on the operator allowlist (RWA_DEMO_OPERATORS, falling back to LP_GATEWAY_CURATORS — unset
// ⇒ 503); a per-wallet rate limit plus an in-process cooldown. Testnet only: the trader holds valueless tokens.

import { createHandler } from '@/lib/web2/routeHandler'
import { V2_COOKIE } from '@/lib/v2/gate'
import { isV2RwaVisible } from '@/lib/v2/rwaGate'
import { runLiveTrade } from '@/lib/rwa/liveTrade'

export const dynamic = 'force-dynamic'

function operators(): string[] {
  const raw = process.env.RWA_DEMO_OPERATORS || process.env.LP_GATEWAY_CURATORS || ''
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^0x[0-9a-f]{40}$/.test(s))
}

export const POST = createHandler(async (req, ctx) => {
  if (!isV2RwaVisible(req.cookies.get(V2_COOKIE)?.value)) return ctx.json({ success: false, error: 'not_found' }, 404)
  const allow = operators()
  if (allow.length === 0) return ctx.json({ success: false, error: 'operators_unset', code: 'NOT_CONFIGURED' }, 503)
  const who = ctx.user!.address.toLowerCase()
  if (!allow.includes(who)) return ctx.json({ success: false, error: 'not_an_operator', code: 'FORBIDDEN' }, 403)

  try {
    const r = await runLiveTrade()
    ctx.log.info('rwa', 'live demo trade', { by: who, hash: r.hash, side: r.side })
    return ctx.json({ success: true, ...r })
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    const known: Record<string, number> = { trade_in_flight: 409, cooldown: 429, trading_paused: 409, appraisal_stale: 409, trader_not_configured: 503 }
    const code = Object.keys(known).find((k) => msg.startsWith(k))
    ctx.log.warn('rwa', 'live demo trade failed', { err: msg })
    return ctx.json({ success: false, error: code ?? 'trade_failed' }, code ? known[code] : 502)
  }
}, { auth: 'signed-message', action: 'mintware-rwa-live-trade', rateLimit: { max: 6, windowMs: 60_000 } })

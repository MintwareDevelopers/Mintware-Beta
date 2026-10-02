// POST /api/rwa/faucet — sends the signer FAUCET_AMOUNT_USD of the valueless testnet dUSD so they can try
// supplying liquidity to the RWA demo unit. Gates (fail-closed): RWA flag + V2 unlock; EIP-191 signed message
// bound to action `mintware-rwa-faucet` (funds go to the recovered signer only); per-wallet rate limit + one claim
// per wallet per day (lib/rwa/faucet.ts). Base Sepolia only.

import { createHandler } from '@/lib/web2/routeHandler'
import { canSeeRwa } from '@/lib/v2/rwaGate'
import { sendDemoUsd } from '@/lib/rwa/faucet'

export const dynamic = 'force-dynamic'

export const POST = createHandler(async (req, ctx) => {
  if (!canSeeRwa(req.cookies)) return ctx.json({ success: false, error: 'not_found' }, 404)
  const to = ctx.user!.address as `0x${string}`
  try {
    const r = await sendDemoUsd(to)
    ctx.log.info('rwa', 'faucet', { to, hash: r.hash })
    return ctx.json({ success: true, ...r })
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    const known: Record<string, number> = { already_claimed: 429, busy: 409, faucet_empty: 503, trader_not_configured: 503 }
    const code = Object.keys(known).find((k) => msg.startsWith(k))
    ctx.log.warn('rwa', 'faucet failed', { err: msg })
    return ctx.json({ success: false, error: code ?? 'faucet_failed' }, code ? known[code] : 502)
  }
}, { auth: 'signed-message', action: 'mintware-rwa-faucet', rateLimit: { max: 3, windowMs: 60_000 } })

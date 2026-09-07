import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { readGatewayPosition } from '@/lib/gateway/positionReader'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveRouteInstance } from '@/lib/gateway/registry'

export const dynamic = 'force-dynamic'

// GET — PUBLIC (auth:'none'). Returns only chain-derivable position figures (shares, NAV/value, cost
// basis, PnL) for any ?address=. It deliberately does NOT disclose the off-chain spendable-buffer
// balance (card_spend_buffers) — that is private per-wallet money data, so it is only served to a
// caller that proves ownership of the address via the signed POST below (audit L-03). Public callers
// always see `bufferBalanceAtomic: null`.
export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  if (!address || !isAddress(address)) {
    return ctx.json({ success: false, error: 'address_required' }, 400)
  }

  const inst = await resolveRouteInstance(ctx.supabase, cfg, req.nextUrl.searchParams.get('pool'))
  if (!inst) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  // Cost basis comes from the DB (populated by the deposit/harvest flows); absent ⇒ null PnL. The
  // buffer balance is intentionally NOT read here — it is owner-gated on the POST path.
  const { data: pos } = await ctx.supabase
    .from('gateway_positions')
    .select('id, entry_nav, shares')
    .eq('user_wallet', address)
    .eq('pool_address', inst.poolAddress)
    .eq('chain_id', inst.chainId)
    .maybeSingle()

  const client = gatewayPublicClient(cfg)

  let view
  try {
    view = await readGatewayPosition({
      client,
      positionManager: inst.positionManager,
      user: address as `0x${string}`,
      costBasisAtomic: pos?.entry_nav != null ? BigInt(String(pos.entry_nav)) : null,
      bufferBalanceAtomic: 0n,
    })
  } catch (e) {
    ctx.log.warn('gateway.position', 'chain read failed', { error: String(e) })
    return ctx.json({ success: false, error: 'chain_read_failed' }, 502)
  }

  return ctx.json({
    success: true,
    position: {
      shares: view.shares,
      positionValueAtomic: view.positionValueAtomic,
      costBasisAtomic: view.costBasisAtomic,
      unrealizedPnlAtomic: view.unrealizedPnlAtomic,
      // Off-chain private data — never disclosed on the public path (audit L-03). Owners read it via POST.
      bufferBalanceAtomic: null,
      // Unharvested fees need a V4 fee-growth read — deferred to a later pass (phase-1 shows realized).
      unharvestedFeesAtomic: null,
    },
  })
})

// POST — OWNER-ONLY (auth:'signed-message', action-bound). Returns the off-chain spendable-buffer
// balance for the wallet that signed the request. The factory recovers the EIP-191 signer and sets
// ctx.user.address; the buffer is read for THAT address only, so a caller can never read another
// wallet's buffer (audit L-03). Body: { address, pool?, authMessage, authSignature, issuedAt } where
// authMessage is buildGatewayBufferMessage(...).
export const POST = createHandler(
  async (req, ctx) => {
    const cfg = gatewayConfig()
    if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

    const owner = ctx.user!.address // proven by signature; already lowercased

    let pool: string | null = null
    try {
      const body = (await req.clone().json()) as { pool?: string | null }
      pool = body.pool ?? null
    } catch {
      // no body pool ⇒ fall back to the default instance
    }

    const inst = await resolveRouteInstance(ctx.supabase, cfg, pool)
    if (!inst) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

    const { data: pos } = await ctx.supabase
      .from('gateway_positions')
      .select('id')
      .eq('user_wallet', owner)
      .eq('pool_address', inst.poolAddress)
      .eq('chain_id', inst.chainId)
      .maybeSingle()

    let bufferBalanceAtomic = 0n
    if (pos?.id) {
      const { data: buf } = await ctx.supabase
        .from('card_spend_buffers')
        .select('buffer_balance_atomic')
        .eq('gateway_position_id', pos.id)
        .maybeSingle()
      if (buf?.buffer_balance_atomic != null) bufferBalanceAtomic = BigInt(String(buf.buffer_balance_atomic))
    }

    return ctx.json({ success: true, bufferBalanceAtomic })
  },
  { auth: 'signed-message', action: 'mintware-gateway-buffer' },
)

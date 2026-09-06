import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { readGatewayPosition } from '@/lib/gateway/positionReader'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'

export const dynamic = 'force-dynamic'

export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  if (!address || !isAddress(address)) {
    return ctx.json({ success: false, error: 'address_required' }, 400)
  }

  // Cost basis + buffer come from the DB (populated by the deposit/harvest flows); absent ⇒ null PnL.
  const { data: pos } = await ctx.supabase
    .from('gateway_positions')
    .select('id, entry_nav, shares')
    .eq('user_wallet', address)
    .eq('pool_address', cfg.poolAddress)
    .eq('chain_id', cfg.chainId)
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

  const client = gatewayPublicClient(cfg)

  let view
  try {
    view = await readGatewayPosition({
      client,
      positionManager: cfg.positionManager,
      user: address as `0x${string}`,
      costBasisAtomic: pos?.entry_nav != null ? BigInt(String(pos.entry_nav)) : null,
      bufferBalanceAtomic,
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
      bufferBalanceAtomic: view.bufferBalanceAtomic,
      // Unharvested fees need a V4 fee-growth read — deferred to a later pass (phase-1 shows realized).
      unharvestedFeesAtomic: null,
    },
  })
})

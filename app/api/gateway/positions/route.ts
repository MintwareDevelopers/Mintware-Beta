import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { readGatewayPosition } from '@/lib/gateway/positionReader'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listActiveInstances } from '@/lib/gateway/registry'

export const dynamic = 'force-dynamic'

// GET — PUBLIC (auth:'none'). The cross-pool aggregate: every LP-gateway position a wallet holds, for the
// Portfolio view. Reads the wallet's `gateway_positions` rows, joins the live `gateway_instances` for the
// positionManager + pair label, and reads each on-chain value in parallel (fail-soft per pool). Like the
// single-pool GET, it discloses only chain-derivable figures (shares/value/cost basis/PnL) — the off-chain
// spendable-buffer stays private and is read per-pool via the owner-signed POST /api/gateway/position (L-03).
export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  if (!address || !isAddress(address)) {
    return ctx.json({ success: false, error: 'address_required' }, 400)
  }

  // The wallet's positions across all pools (cost basis + shares live in the DB).
  const { data: rows } = await ctx.supabase
    .from('gateway_positions')
    .select('pool_address, chain_id, entry_nav, shares')
    .eq('user_wallet', address)

  const posRows = (rows ?? []) as { pool_address: string; chain_id: number; entry_nav: unknown; shares: unknown }[]
  if (posRows.length === 0) return ctx.json({ success: true, positions: [] })

  // Live instances (pool → positionManager + label) so we only surface pools still curated/deployed.
  const instances = await listActiveInstances(ctx.supabase, cfg.chainId)
  const byPool = new Map(instances.map((i) => [i.poolAddress.toLowerCase(), i]))
  const client = gatewayPublicClient(cfg)

  const positions = (
    await Promise.all(
      posRows.map(async (row) => {
        const inst = byPool.get(String(row.pool_address).toLowerCase())
        if (!inst) return null // pool no longer active/registered — skip
        try {
          const view = await readGatewayPosition({
            client,
            positionManager: inst.positionManager,
            user: address as `0x${string}`,
            costBasisAtomic: row.entry_nav != null ? BigInt(String(row.entry_nav)) : null,
            bufferBalanceAtomic: 0n,
          })
          if (BigInt(view.shares) <= 0n) return null // fully withdrawn — omit
          return {
            poolAddress: inst.poolAddress,
            pairLabel: inst.pairLabel,
            chainId: inst.chainId,
            shares: view.shares,
            positionValueAtomic: view.positionValueAtomic,
            costBasisAtomic: view.costBasisAtomic,
            unrealizedPnlAtomic: view.unrealizedPnlAtomic,
            // Off-chain private data — owner-gated on POST /api/gateway/position (L-03).
            bufferBalanceAtomic: null,
          }
        } catch (e) {
          ctx.log.warn('gateway.positions', 'chain read failed for pool', { pool: inst.poolAddress, error: String(e) })
          return null
        }
      }),
    )
  ).filter((p): p is NonNullable<typeof p> => p !== null)

  return ctx.json({ success: true, positions })
})

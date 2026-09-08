import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { readGatewayPosition } from '@/lib/gateway/positionReader'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listResolvableInstances } from '@/lib/gateway/routeInstance'

export const dynamic = 'force-dynamic'

// GET — PUBLIC (auth:'none'). The cross-pool aggregate: every LP-gateway position a wallet holds, for the
// Portfolio view. CHAIN-FIRST (audit O-1 / HO-1): enumerate every resolvable instance (active registry
// rows, or the env rig while the registry is empty), read `sharesOf` for the wallet on each, and surface
// every pool with shares > 0. The wallet's `gateway_positions` rows are ENRICHMENT only (cost basis +
// whether the deposit was recorded) — a depositor whose record call failed still sees their position.
// Like the single-pool GET, it discloses only chain-derivable figures; the off-chain spendable buffer
// stays private and is read per-pool via the owner-signed POST /api/gateway/position (L-03).
export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  if (!address || !isAddress(address)) {
    return ctx.json({ success: false, error: 'address_required' }, 400)
  }

  const instances = await listResolvableInstances(ctx.supabase, cfg)
  if (instances.length === 0) return ctx.json({ success: true, positions: [] })

  // DB enrichment: cost basis per pool (may be absent when a record call never landed).
  const { data: rows } = await ctx.supabase
    .from('gateway_positions')
    .select('pool_address, chain_id, entry_nav, shares')
    .eq('user_wallet', address)
  const basisByPool = new Map<string, { entry_nav: unknown }>()
  for (const r of (rows ?? []) as { pool_address: string; chain_id: number; entry_nav: unknown }[]) {
    basisByPool.set(`${String(r.pool_address).toLowerCase()}:${Number(r.chain_id)}`, r)
  }

  const client = gatewayPublicClient(cfg)

  const positions = (
    await Promise.all(
      instances.map(async (inst) => {
        const row = basisByPool.get(`${inst.poolAddress}:${inst.chainId}`)
        try {
          const view = await readGatewayPosition({
            client,
            positionManager: inst.positionManager,
            user: address as `0x${string}`,
            costBasisAtomic: row?.entry_nav != null ? BigInt(String(row.entry_nav)) : null,
            bufferBalanceAtomic: 0n,
          })
          if (BigInt(view.shares) <= 0n) return null // nothing on-chain in this pool — omit
          return {
            poolAddress: inst.poolAddress,
            pairLabel: inst.pairLabel,
            chainId: inst.chainId,
            shares: view.shares,
            positionValueAtomic: view.positionValueAtomic,
            costBasisAtomic: view.costBasisAtomic,
            unrealizedPnlAtomic: view.unrealizedPnlAtomic,
            recorded: row != null, // false ⇒ chain shows shares but no record row (O-1) — cost basis unknown
            source: inst.source,
            live: inst.live,
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

  // Value history for per-pool sparklines (Krystal item 8) — one query for the wallet, grouped by pool.
  // On-chain-derived series, not private; oldest→newest so the sparkline reads left-to-right.
  const { data: snaps } = await ctx.supabase
    .from('gateway_position_snapshots')
    .select('pool_address, taken_at, position_value_atomic')
    .eq('user_wallet', address)
    .order('taken_at', { ascending: true })
    .limit(600)
  const seriesByPool = new Map<string, number[]>()
  for (const s of (snaps ?? []) as { pool_address: string; position_value_atomic: unknown }[]) {
    const k = String(s.pool_address).toLowerCase()
    const v = Number(s.position_value_atomic ?? 0) / 1e6
    if (!Number.isFinite(v)) continue
    const arr = seriesByPool.get(k) ?? []
    arr.push(v)
    seriesByPool.set(k, arr)
  }

  const withHistory = positions.map((p) => ({ ...p, valueSeries: seriesByPool.get(p.poolAddress.toLowerCase()) ?? [] }))

  return ctx.json({ success: true, positions: withHistory })
})

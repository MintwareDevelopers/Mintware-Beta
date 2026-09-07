// LP-gateway position snapshotter (Krystal item 8). Walks every active gateway's depositor set, reads
// each position's current mark on-chain (the SAME offset-consistent share math as withdraw), and writes
// a time-series row (value, cost basis, signed PnL). Pure observability — reads chain + writes snapshots,
// never moves money. Powers the historical PnL / fees-vs-IL view. No-ops (0) until the chain config is set.

import { getServiceClient } from '@/lib/web2/supabase'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listActiveInstances } from '@/lib/gateway/registry'
import { readGatewayPosition } from '@/lib/gateway/positionReader'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = {
  info: (t: string, m: string, c?: Record<string, unknown>) => void
  warn: (t: string, m: string, c?: Record<string, unknown>) => void
}
const big = (v: unknown) => BigInt(String(v ?? '0'))

export async function snapshotAll(opts: { supabase: SupabaseClient; log?: Logger }): Promise<{ snapshotted: number; pools: number }> {
  const cfg = gatewayConfig()
  if (!cfg) return { snapshotted: 0, pools: 0 }
  const client = gatewayPublicClient(cfg)
  const active = await listActiveInstances(opts.supabase, cfg.chainId)
  const targets = active.length
    ? active.map((i) => ({ positionManager: i.positionManager, poolAddress: i.poolAddress, chainId: i.chainId }))
    : cfg.positionManager && cfg.poolAddress
      ? [{ positionManager: cfg.positionManager, poolAddress: cfg.poolAddress, chainId: cfg.chainId }]
      : []

  let snapshotted = 0
  for (const inst of targets) {
    const { data: rows } = await opts.supabase
      .from('gateway_positions')
      .select('user_wallet, shares, entry_nav')
      .eq('pool_address', inst.poolAddress)
      .eq('chain_id', inst.chainId)
    for (const r of (rows ?? []) as Array<{ user_wallet: string; shares: unknown; entry_nav: unknown }>) {
      if (big(r.shares) <= 0n) continue
      try {
        const basis = big(r.entry_nav)
        const view = await readGatewayPosition({
          client, positionManager: inst.positionManager, user: String(r.user_wallet).toLowerCase() as `0x${string}`, costBasisAtomic: basis,
        })
        const pnl = view.unrealizedPnlAtomic ?? view.positionValueAtomic - basis
        await opts.supabase.from('gateway_position_snapshots').insert({
          user_wallet: String(r.user_wallet).toLowerCase(),
          pool_address: inst.poolAddress,
          chain_id: inst.chainId,
          shares: view.shares.toString(),
          position_value_atomic: view.positionValueAtomic.toString(),
          cost_basis_atomic: basis.toString(),
          pnl_atomic: pnl.toString(),
        })
        snapshotted++
      } catch (e) {
        opts.log?.warn('gateway.snapshot', 'position read failed', { error: String(e), user: String(r.user_wallet) })
      }
    }
  }
  return { snapshotted, pools: targets.length }
}

// Multi-pool registry — the app + crons discover every live gateway here instead of a single env
// instance. Pure DB access (takes a service-role client). One isolated gateway per pool.

import { getServiceClient } from '@/lib/web2/supabase'
import type { GatewayConfig } from '@/lib/gateway/chain'

type SupabaseClient = ReturnType<typeof getServiceClient>

export type RouteInstance = { positionManager: `0x${string}`; poolAddress: string; chainId: number }

/** Resolve the gateway a route should act on: registry match by pool, else the single-env fallback. */
export async function resolveRouteInstance(
  supabase: SupabaseClient,
  cfg: GatewayConfig,
  poolParam?: string | null,
): Promise<RouteInstance | null> {
  if (poolParam) {
    const inst = await resolveGatewayByPool(supabase, poolParam, cfg.chainId)
    if (inst) return { positionManager: inst.positionManager, poolAddress: inst.poolAddress, chainId: inst.chainId }
  }
  if (cfg.positionManager && cfg.poolAddress) {
    return { positionManager: cfg.positionManager, poolAddress: cfg.poolAddress, chainId: cfg.chainId }
  }
  return null
}

export type GatewayInstance = {
  id: string
  poolAddress: string
  chainId: number
  pairLabel: string | null
  positionManager: `0x${string}`
  staging: `0x${string}`
  quoteAsset: `0x${string}`
  pairedAsset: string | null
  tickLower: number | null
  tickUpper: number | null
}

function map(r: Record<string, unknown>): GatewayInstance {
  return {
    id: String(r.id),
    poolAddress: String(r.pool_address),
    chainId: Number(r.chain_id),
    pairLabel: (r.pair_label as string) ?? null,
    positionManager: String(r.position_manager) as `0x${string}`,
    staging: String(r.staging) as `0x${string}`,
    quoteAsset: String(r.quote_asset) as `0x${string}`,
    pairedAsset: (r.paired_asset as string) ?? null,
    tickLower: r.tick_lower != null ? Number(r.tick_lower) : null,
    tickUpper: r.tick_upper != null ? Number(r.tick_upper) : null,
  }
}

export async function listActiveInstances(supabase: SupabaseClient, chainId?: number): Promise<GatewayInstance[]> {
  let q = supabase.from('gateway_instances').select('*').eq('status', 'active')
  if (chainId != null) q = q.eq('chain_id', chainId)
  const { data } = await q
  return (data ?? []).map(map)
}

export async function resolveGatewayByPool(
  supabase: SupabaseClient,
  poolAddress: string,
  chainId: number,
): Promise<GatewayInstance | null> {
  const { data } = await supabase
    .from('gateway_instances')
    .select('*')
    .eq('pool_address', poolAddress.toLowerCase())
    .eq('chain_id', chainId)
    .eq('status', 'active')
    .maybeSingle()
  return data ? map(data as Record<string, unknown>) : null
}

export async function registerInstance(
  supabase: SupabaseClient,
  i: {
    poolAddress: string
    chainId: number
    pairLabel?: string | null
    positionManager: string
    staging: string
    quoteAsset: string
    pairedAsset?: string | null
    tickLower?: number | null
    tickUpper?: number | null
    createdBy?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('gateway_instances').upsert(
    {
      pool_address: i.poolAddress.toLowerCase(),
      chain_id: i.chainId,
      pair_label: i.pairLabel ?? null,
      position_manager: i.positionManager.toLowerCase(),
      staging: i.staging.toLowerCase(),
      quote_asset: i.quoteAsset.toLowerCase(),
      paired_asset: i.pairedAsset?.toLowerCase() ?? null,
      tick_lower: i.tickLower ?? null,
      tick_upper: i.tickUpper ?? null,
      status: 'active',
      created_by: i.createdBy ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'pool_address,chain_id' },
  )
  return error ? { ok: false, error: error.message } : { ok: true }
}

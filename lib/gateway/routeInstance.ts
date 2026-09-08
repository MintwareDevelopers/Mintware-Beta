// Strict pool → gateway-instance resolution for the money-path routes (audit O-2 / HO-2 / R-1).
//
// The registry keys instances by the 32-byte v4 poolId (or a 20-byte address for non-v4 pools). The
// old `resolveRouteInstance` fell back to the single-env PositionManager on ANY miss and the routes
// reported `live: true` — so every `/earn/<anything>` advertised (and deposited into) the env rig.
// This resolver:
//   · accepts a 20- or 32-byte hex pool id (same shape rule as discovery.normalizePoolId);
//   · when the registry holds ≥1 active instance, a miss is a 404 — NEVER the env fallback;
//   · the env fallback is served ONLY while the registry is empty, and only when the requested pool
//     matches `LP_GATEWAY_POOL_ADDRESS` (or no pool was requested), tagged `source: 'env-fallback'`;
//   · `live` is derived from an active registry hit; the env rig is never "live".
// Consumes registry.ts exports as they are today (listActiveInstances) — no registry writes here.

import type { GatewayConfig } from '@/lib/gateway/chain'
import { listActiveInstances, type GatewayInstance } from '@/lib/gateway/registry'
import { getServiceClient } from '@/lib/web2/supabase'

type SupabaseClient = ReturnType<typeof getServiceClient>

export type InstanceSource = 'registry' | 'env-fallback'

export type ResolvedInstance = {
  positionManager: `0x${string}`
  poolAddress: string // the registry key (poolId), lowercased
  chainId: number
  staging: `0x${string}` | null
  quoteAsset: `0x${string}` | null
  pairLabel: string | null
  tickLower: number | null
  tickUpper: number | null
  source: InstanceSource
  live: boolean // true only for an ACTIVE registry row
}

export type ResolveResult =
  | { ok: true; inst: ResolvedInstance }
  | { ok: false; status: 404 | 503; error: 'pool_not_live' | 'pool_required' | 'gateway_not_configured' }

/** Same shape rule as discovery.ts `normalizePoolId` (not exported there): a 20-byte address or a
 *  32-byte v4 poolId, lowercased; anything else ⇒ ''. */
export function normalizePoolId(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(s) || /^0x[0-9a-f]{64}$/.test(s) ? s : ''
}

function fromRegistry(i: GatewayInstance): ResolvedInstance {
  return {
    positionManager: i.positionManager,
    poolAddress: i.poolAddress.toLowerCase(),
    chainId: i.chainId,
    staging: i.staging ?? null,
    quoteAsset: i.quoteAsset ?? null,
    pairLabel: i.pairLabel ?? null,
    tickLower: i.tickLower ?? null,
    tickUpper: i.tickUpper ?? null,
    source: 'registry',
    live: true,
  }
}

function fromEnv(cfg: GatewayConfig): ResolvedInstance | null {
  if (!cfg.positionManager || !cfg.poolAddress) return null
  const usdg = process.env.LP_GATEWAY_USDG
  return {
    positionManager: cfg.positionManager,
    poolAddress: cfg.poolAddress.toLowerCase(),
    chainId: cfg.chainId,
    staging: cfg.staging ?? null,
    quoteAsset: usdg && /^0x[0-9a-fA-F]{40}$/.test(usdg) ? (usdg.toLowerCase() as `0x${string}`) : null,
    pairLabel: null,
    tickLower: null,
    tickUpper: null,
    source: 'env-fallback',
    live: false,
  }
}

/** Every instance the money path may act on: all active registry rows, or — only while the registry is
 *  empty — the single env rig. Used by the Portfolio aggregate + anything that must enumerate. */
export async function listResolvableInstances(supabase: SupabaseClient, cfg: GatewayConfig): Promise<ResolvedInstance[]> {
  const active = await listActiveInstances(supabase, cfg.chainId)
  if (active.length > 0) return active.map(fromRegistry)
  const env = fromEnv(cfg)
  return env ? [env] : []
}

/** Resolve the instance a route should act on for `poolParam` (see header for the rules). */
export async function resolveInstanceStrict(
  supabase: SupabaseClient,
  cfg: GatewayConfig,
  poolParam?: string | null,
): Promise<ResolveResult> {
  const active = await listActiveInstances(supabase, cfg.chainId)
  const raw = (poolParam ?? '').trim().toLowerCase()

  if (active.length > 0) {
    if (!raw) {
      // No pool requested: unambiguous only when exactly one instance is live.
      return active.length === 1 ? { ok: true, inst: fromRegistry(active[0]) } : { ok: false, status: 404, error: 'pool_required' }
    }
    const id = normalizePoolId(raw)
    // Match the registry key exactly (poolId), or a legacy label-keyed row — never a fallback on miss.
    const hit = active.find((i) => i.poolAddress.toLowerCase() === (id || raw))
    return hit ? { ok: true, inst: fromRegistry(hit) } : { ok: false, status: 404, error: 'pool_not_live' }
  }

  // Registry empty → the env rig is the only candidate, and only for its own pool (or no pool).
  const env = fromEnv(cfg)
  if (!env) return { ok: false, status: 503, error: 'gateway_not_configured' }
  if (raw && raw !== env.poolAddress && normalizePoolId(raw) !== env.poolAddress) {
    return { ok: false, status: 404, error: 'pool_not_live' }
  }
  return { ok: true, inst: env }
}

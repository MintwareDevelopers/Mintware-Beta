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
//
// 2026-09-09 fix (independent Codex audit, V1-01): deposit ELIGIBILITY and exit/read DISCOVERY are two
// different questions and must not share one active-only lookup. `deactivateInstance`'s own doc comment
// promises "withdraw-only resolution keeps working" for a retired row — but nothing ever called
// `listAllInstances` from the money-path routes, so a deactivated (or superseded-by-reregistration)
// instance 404'd out of `withdraw`/`position` and silently vanished from the portfolio, even though the
// depositor's on-chain shares were completely intact and directly withdrawable by calling the contract
// itself. `includeInactive` opts a caller into resolving retired rows too — `deposit` must NEVER pass
// it (deposit eligibility stays active-only); every read/exit path now does.
//
// Consumes registry.ts exports as they are today (listActiveInstances/listAllInstances) — no registry
// writes here.

import type { GatewayConfig } from '@/lib/gateway/chain'
import { listActiveInstances, listAllInstances, type GatewayInstance } from '@/lib/gateway/registry'
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
    // 2026-09-09 fix (V1-01): reflects the row's real status — an inactive row resolved via
    // `includeInactive` is NOT live (no new deposits), but still fully resolvable for reads/withdraw.
    live: i.status === 'active',
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

/** Every instance the money path may act on: all active registry rows PLUS every retired (inactive)
 *  one — a depositor's shares don't stop existing when a pool is deactivated or superseded, so their
 *  position must stay enumerable and actionable (V1-01). Falls back to the single env rig only while
 *  the registry is completely empty. Used by the Portfolio aggregate + anything that must enumerate
 *  every position a wallet could hold. */
export async function listResolvableInstances(supabase: SupabaseClient, cfg: GatewayConfig): Promise<ResolvedInstance[]> {
  const all = await listAllInstances(supabase, cfg.chainId)
  if (all.length > 0) return all.map(fromRegistry)
  const env = fromEnv(cfg)
  return env ? [env] : []
}

/** Resolve the instance a route should act on for `poolParam` (see header for the rules).
 *
 *  `opts.includeInactive` (V1-01 fix): when true, a retired (inactive) registry row still resolves
 *  `ok: true` (with `live: false`) instead of 404ing — for reads and withdrawal, never for deposit
 *  eligibility. The no-pool-given convenience shortcut ("exactly one instance ⇒ use it") stays scoped
 *  to ACTIVE rows regardless of this flag: guessing a caller's intent onto a retired pool they didn't
 *  name is not a safe default, and every read/withdraw caller in this codebase always names its pool. */
export async function resolveInstanceStrict(
  supabase: SupabaseClient,
  cfg: GatewayConfig,
  poolParam?: string | null,
  opts: { includeInactive?: boolean } = {},
): Promise<ResolveResult> {
  const active = await listActiveInstances(supabase, cfg.chainId)
  const raw = (poolParam ?? '').trim().toLowerCase()

  if (active.length > 0) {
    if (!raw) {
      // No pool requested: unambiguous only when exactly one instance is live (active-only, see above).
      return active.length === 1 ? { ok: true, inst: fromRegistry(active[0]) } : { ok: false, status: 404, error: 'pool_required' }
    }
    const id = normalizePoolId(raw)
    const pool = id || raw
    // Match the registry key exactly (poolId), or a legacy label-keyed row — never a fallback on miss.
    const hit = active.find((i) => i.poolAddress.toLowerCase() === pool)
    if (hit) return { ok: true, inst: fromRegistry(hit) }
    if (opts.includeInactive) {
      const all = await listAllInstances(supabase, cfg.chainId)
      const retired = all.find((i) => i.poolAddress.toLowerCase() === pool)
      if (retired) return { ok: true, inst: fromRegistry(retired) }
    }
    return { ok: false, status: 404, error: 'pool_not_live' }
  }

  // No ACTIVE instance at all. Before falling to the env rig (below — unchanged, active-empty-only
  // behavior), give includeInactive one more chance: the registry may still hold a RETIRED row for
  // exactly the pool being asked about (e.g. the operator retired the ONLY instance there ever was).
  // This must NOT short-circuit past the env-fallback logic when there's no such match — a truly
  // empty registry (no rows at all, active or retired) still needs the env rig to work exactly as
  // before; that's the regression this comment guards against (caught by this file's own test suite).
  if (opts.includeInactive) {
    if (!raw) {
      const all = await listAllInstances(supabase, cfg.chainId)
      if (all.length === 1) return { ok: true, inst: fromRegistry(all[0]) }
    } else {
      const id = normalizePoolId(raw)
      const pool = id || raw
      const all = await listAllInstances(supabase, cfg.chainId)
      const retired = all.find((i) => i.poolAddress.toLowerCase() === pool)
      if (retired) return { ok: true, inst: fromRegistry(retired) }
    }
  }

  // Registry (active + retired) has no match → the env rig is the only remaining candidate, and only
  // for its own pool (or no pool).
  const env = fromEnv(cfg)
  if (!env) return { ok: false, status: 503, error: 'gateway_not_configured' }
  if (raw && raw !== env.poolAddress && normalizePoolId(raw) !== env.poolAddress) {
    return { ok: false, status: 404, error: 'pool_not_live' }
  }
  return { ok: true, inst: env }
}

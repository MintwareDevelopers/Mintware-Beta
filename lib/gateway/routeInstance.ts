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
// KNOWN RESIDUAL (documented, not silently left): resolution is keyed by POOL ID alone. If a pool is
// retired and later re-registered with a DIFFERENT PositionManager (a full PM migration, not just a
// pause — see the V1 pass-2 fix on `registerInstance` in registry.ts), a bare poolId lookup here always
// returns the CURRENT active row, never a superseded one — even with `includeInactive`, since an active
// hit short-circuits before that check runs. A depositor of the SUPERSEDED PM can still be found via
// `listAllInstances`/`listResolvableInstances` (their position stays enumerable — the portfolio and
// `/api/gateway/instances` show it), but a route resolving purely by poolId (withdraw/position/meta)
// will resolve to the NEW PM, not theirs — `withdraw`'s own `receipt.to` check would then correctly
// reject their tx as `wrong_contract` rather than silently misroute it, so this fails SAFE, just not
// USABLE for that specific compound scenario. Simple retirement (no later re-registration — by far the
// more common real case) is fully fixed end-to-end by the change below. Fully closing the compound case
// would need routes to resolve by (pool, positionManager) once a receipt names a specific PM, not by
// pool alone — flagged as a follow-up, not implemented in this pass.
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
import { listAllInstances, type GatewayInstance } from '@/lib/gateway/registry'
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
 *  name is not a safe default, and every read/withdraw caller in this codebase always names its pool.
 *
 *  V1 pass-2 fix (independent Codex audit, 2026-09-09): the env-fallback rig is eligible ONLY when the
 *  registry has NEVER held a row for this chain at all (genuine pre-registry bootstrap) — a single
 *  `listAllInstances` call decides that now, not `listActiveInstances` on its own. The earlier version
 *  fell to the env rig whenever there were zero ACTIVE rows, which is also true the moment an operator
 *  deliberately retires the LAST (or only) registered instance — silently reopening deposits through
 *  a stale bootstrap `LP_GATEWAY_POSITION_MANAGER`/`POOL_ADDRESS` env config that, in practice, is
 *  rarely unset even long after the registry takes over. A deliberately-emptied-of-ACTIVE-rows registry
 *  must 404, never quietly resurrect the pre-registry rig. */
export async function resolveInstanceStrict(
  supabase: SupabaseClient,
  cfg: GatewayConfig,
  poolParam?: string | null,
  opts: { includeInactive?: boolean } = {},
): Promise<ResolveResult> {
  const all = await listAllInstances(supabase, cfg.chainId)
  const active = all.filter((i) => i.status === 'active')
  const raw = (poolParam ?? '').trim().toLowerCase()

  if (all.length > 0) {
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
      const retired = all.find((i) => i.poolAddress.toLowerCase() === pool)
      if (retired) return { ok: true, inst: fromRegistry(retired) }
    }
    return { ok: false, status: 404, error: 'pool_not_live' }
  }

  // The registry has NEVER held a row for this chain (genuine bootstrap) → the env rig is the only
  // candidate, and only for its own pool (or no pool).
  const env = fromEnv(cfg)
  if (!env) return { ok: false, status: 503, error: 'gateway_not_configured' }
  if (raw && raw !== env.poolAddress && normalizePoolId(raw) !== env.poolAddress) {
    return { ok: false, status: 404, error: 'pool_not_live' }
  }
  return { ok: true, inst: env }
}

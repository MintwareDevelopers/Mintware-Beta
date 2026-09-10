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
// FIXED (2026-09-09, same day, follow-up to the residual below): a bare poolId lookup still resolves
// the CURRENT active row when one exists (unchanged — that's the right default for every caller that
// doesn't care which generation). But `opts.positionManager`, when given alongside a pool, matches an
// EXACT (pool, PM) pair across every row regardless of status, short-circuiting before the active-wins
// logic runs at all — a depositor of a superseded PM is now genuinely reachable through withdraw/
// position/meta, not just enumerable. `positions`/`listResolvableInstances` now surface each position's
// own `positionManager`; the Portfolio's per-pool link carries it as a `?pm=` param; `/earn/[pool]`
// threads it back into meta/position/withdraw. See app/api/gateway/withdraw/route.ts (derives the PM
// straight from the tx receipt itself, so it's never a caller-supplied claim) and
// components/web2/v1/V1Portfolio.tsx / V1PoolDetail.tsx.
//
// CLOSED 2026-09-09/10 (independent Codex audit, round-4 pass-2, revised 2026-09-10): the residual
// documented here used to say `gateway_positions` was keyed by (user_wallet, pool_address, chain_id) —
// NOT positionManager — so a wallet with deposits in both a retired and a replacement PM for the SAME
// pool had its cost basis co-mingled in one row. Migration 20260909000005 adds position_manager to that
// table's identity (+ gateway_deposit_events, for the event-order replay from 20260909000004 to scope
// correctly per generation too). Its FIRST two designs both guessed at ambiguous pre-existing history
// (a migration-time "prefer the active PM" backfill, then a runtime "first write adopts everything" rule)
// and were both caught by Codex's live watch as actively wrong, not just imperfect — a wallet whose real
// history sits in a RETIRED PM could have that basis silently reassigned to an unrelated new generation.
// FINAL design: record_gateway_deposit_event/record_gateway_withdraw_event operate on an EXACT (wallet,
// pool, chain, PM) match ONLY, no guessing anywhere; the position/positions read routes do the same. An
// orphaned (position_manager IS NULL) row is left untouched and invisible until
// scripts/verify-gateway-pm-attribution.mjs resolves it from a REAL on-chain receipt (never inferred) and
// migration 20260909000006's `recompute_gateway_position` recomputes it from that verified history. See
// app/api/gateway/{position,positions}/route.ts and 20260909000005's header comment for the full design.
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
  opts: { includeInactive?: boolean; positionManager?: string | null } = {},
): Promise<ResolveResult> {
  const all = await listAllInstances(supabase, cfg.chainId)
  const active = all.filter((i) => i.status === 'active')
  const raw = (poolParam ?? '').trim().toLowerCase()
  // V1-01 pass-2 residual fix (independent Codex audit, 2026-09-09): naming an EXACT (pool, PM) pair
  // sidesteps the "active always wins" ambiguity below entirely — a bare poolId lookup has no way to
  // pick out a SUPERSEDED PM once its pool has a newer active instance (see the header comment's
  // documented residual). Any caller that has a specific PM to name (a withdraw route reading it off
  // the transaction receipt, a portfolio link built from a position that carries its own PM identity)
  // gets it regardless of active/inactive status — this check runs first and short-circuits.
  //
  // CAUGHT ON REVIEW (2026-09-09, same day): the first version of this check ran unconditionally,
  // BEFORE the `all.length > 0` gate below — with a genuinely empty registry (bootstrap, env-fallback
  // territory), `all.find(...)` always came back empty and this returned 404 before ever reaching the
  // env-fallback logic. That silently broke every withdrawal during the bootstrap phase (withdraw
  // derives its `positionManager` from the tx receipt unconditionally — see withdraw/route.ts — so
  // ANY bootstrap withdrawal now supplied one). Scoped to `all.length > 0` — registry search only makes
  // sense once the registry has actually held a row; a genuinely empty registry falls through to the
  // env-fallback block below, which now separately validates the wanted PM against the env rig's own
  // address instead of ignoring it.
  const wantPm = (opts.positionManager ?? '').trim().toLowerCase()
  if (wantPm && raw && all.length > 0) {
    const id = normalizePoolId(raw)
    const pool = id || raw
    const hit = all.find((i) => i.poolAddress.toLowerCase() === pool && i.positionManager.toLowerCase() === wantPm)
    return hit ? { ok: true, inst: fromRegistry(hit) } : { ok: false, status: 404, error: 'pool_not_live' }
  }

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
  // Same bootstrap-regression fix as above: a caller naming a specific PM (withdraw, off the tx
  // receipt) must still fail closed if it doesn't match the env rig's own PM — silently ignoring a
  // mismatched `positionManager` here would let a withdraw against a WRONG contract resolve to the
  // env instance anyway, purely because the pool matched.
  if (wantPm && env.positionManager.toLowerCase() !== wantPm) {
    return { ok: false, status: 404, error: 'pool_not_live' }
  }
  return { ok: true, inst: env }
}

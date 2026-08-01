// =============================================================================
// lib/web2/router/listing.ts — registry of MW V4 pools a swap can route against
//
// TODAY THIS REGISTRY IS EMPTY. Phase-3 Track 0 (MintwareVaultFactory + on-chain
// registry, mirrored to Supabase) has not shipped, so no pair is "listed" and the
// meta-router always falls through to LI.FI. This module is the seam that goes
// live the moment pools exist: swap EMPTY_REGISTRY for a factory/Supabase-backed
// PoolRegistry then, without touching pickBest or the orchestrator.
//
// Fail-safe: ANY error, missing config, or degenerate input → null (→ LI.FI).
// A listing lookup must never be able to block or mis-route a swap.
// =============================================================================

import type { ListedPool } from './types'

/** A source of listed pools. Injected so it's swappable + trivially testable. */
export interface PoolRegistry {
  find(chainId: number, tokenA: string, tokenB: string): Promise<ListedPool | null>
}

/** Default registry — empty until Track 0 lands. Always returns null. */
export const EMPTY_REGISTRY: PoolRegistry = {
  async find() {
    return null
  },
}

function norm(a: string): string {
  return a.trim().toLowerCase()
}

/**
 * Look up a MW pool for a token pair (order-independent). Returns null when:
 *  - the chainId is invalid,
 *  - either token is missing,
 *  - the pair is degenerate (same token both sides),
 *  - no pool is listed, or
 *  - the registry throws.
 */
export async function getListedPool(
  chainId: number,
  tokenIn: string,
  tokenOut: string,
  registry: PoolRegistry = EMPTY_REGISTRY,
): Promise<ListedPool | null> {
  try {
    if (!Number.isInteger(chainId) || chainId <= 0) return null
    if (!tokenIn || !tokenOut) return null
    const a = norm(tokenIn)
    const b = norm(tokenOut)
    if (a === b) return null
    return await registry.find(chainId, a, b)
  } catch {
    return null
  }
}

/**
 * Build an in-memory registry from a static pool list (order-independent match).
 * Used for tests today and as the trivial source once Track 0 seeds a handful of
 * pools before the full factory/Supabase registry exists.
 */
export function staticRegistry(pools: ListedPool[]): PoolRegistry {
  return {
    async find(chainId, tokenA, tokenB) {
      const a = norm(tokenA)
      const b = norm(tokenB)
      return (
        pools.find(
          p =>
            p.chainId === chainId &&
            ((norm(p.currency0) === a && norm(p.currency1) === b) ||
              (norm(p.currency0) === b && norm(p.currency1) === a)),
        ) ?? null
      )
    },
  }
}

/**
 * V4 swap direction for selling `tokenIn` into a pool: zeroForOne is true when
 * tokenIn is currency0 (selling currency0 → buying currency1).
 */
export function isZeroForOne(pool: ListedPool, tokenIn: string): boolean {
  return norm(tokenIn) === norm(pool.currency0)
}

/** A `router_pools` registry row (snake_case, as stored in Supabase). */
export interface RouterPoolRow {
  chain_id: number
  router: string
  hooks: string
  currency0: string
  currency1: string
  fee: number
  tick_spacing: number
  active?: boolean
}

/** Loads the active pool rows for a chain. Backed by Supabase in production. */
export type RouterPoolFetcher = (chainId: number) => Promise<RouterPoolRow[]>

function rowToPool(r: RouterPoolRow): ListedPool {
  return {
    chainId:     r.chain_id,
    router:      r.router,
    hooks:       r.hooks,
    currency0:   r.currency0,
    currency1:   r.currency1,
    fee:         r.fee,
    tickSpacing: r.tick_spacing,
  }
}

/**
 * Build a PoolRegistry from a row fetcher (e.g. a Supabase query). Inactive rows
 * are dropped. Order-independent pair match. The fetcher's errors propagate to
 * `getListedPool`, which swallows them → null → LI.FI (fail-safe).
 */
export function registryFromFetcher(fetchRows: RouterPoolFetcher): PoolRegistry {
  return {
    async find(chainId, tokenA, tokenB) {
      const rows  = await fetchRows(chainId)
      const pools = rows.filter(r => r.active !== false).map(rowToPool)
      return staticRegistry(pools).find(chainId, tokenA, tokenB)
    },
  }
}

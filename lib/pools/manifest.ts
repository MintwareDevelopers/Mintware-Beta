// Mintware liquidity manifest — the standard "discover our liquidity" surface for solver / aggregator
// networks (UniswapX, CoW, 1inch Fusion) and indexers, served CORS-open at GET /api/pools. Making our v4
// pools discoverable + routable is a DISTRIBUTION move: real flow finding our liquidity is what turns every
// yield lever (swap fee, LVR capture, am-AMM) into realized yield. Pure shaping/validation; the pool DATA is
// operator-supplied (env), never fabricated here.

export type PoolKind = 'community' | 'bluechip'

/** One Mintware v4 pool, in a shape a solver/indexer can route + price against. */
export interface PoolEntry {
  chainId: number
  /** v4 pool id (keccak256 of the PoolKey), 0x-hex. */
  poolId: string
  currency0: string
  currency1: string
  /** Static fee in pips, or 'dynamic' when the hook overrides per-swap. */
  fee: number | 'dynamic'
  tickSpacing: number
  /** The hook address (dynamic fee / am-AMM / circuit breaker live here). */
  hooks: string
  /** The pool's SOLE liquidity provider — a Mintware vault. */
  vault: string
  kind: PoolKind
  /** Routing constraints an integrator must respect (see the hook). */
  routing: {
    /** Managed am-AMM pools handle exact-INPUT only; exact-output reverts. */
    exactInputOnly: boolean
    /** A truncated-oracle circuit breaker reverts swaps at extreme deviation. */
    hasCircuitBreaker: boolean
    /** Fee is quoted per-swap (read the hook / simulate), not a fixed tier. */
    dynamicFee: boolean
  }
}

export interface PoolsManifest {
  name: string
  version: string
  /** Where an integrator reads current per-swap pricing (simulate on-chain). */
  quoteHint: string
  pools: PoolEntry[]
}

const EVM = /^0x[0-9a-fA-F]{40}$/
const POOLID = /^0x[0-9a-fA-F]{64}$/

/** Validate + normalize a single raw pool entry, or return an error string. Rejects malformed data so the
 *  manifest never advertises a pool a solver can't actually route. */
export function normalizePool(raw: unknown): { ok: true; pool: PoolEntry } | { ok: false; error: string } {
  const p = raw as Record<string, unknown>
  if (typeof p?.chainId !== 'number' || !Number.isInteger(p.chainId)) return { ok: false, error: 'bad_chainId' }
  if (typeof p?.poolId !== 'string' || !POOLID.test(p.poolId)) return { ok: false, error: 'bad_poolId' }
  for (const k of ['currency0', 'currency1', 'hooks', 'vault'] as const) {
    if (typeof p?.[k] !== 'string' || !EVM.test(p[k] as string)) return { ok: false, error: `bad_${k}` }
  }
  if (typeof p?.tickSpacing !== 'number' || !Number.isInteger(p.tickSpacing) || (p.tickSpacing as number) <= 0) {
    return { ok: false, error: 'bad_tickSpacing' }
  }
  const dynamicFee = p.fee === 'dynamic'
  const fee = dynamicFee ? 'dynamic' : Number(p.fee)
  if (!dynamicFee && (!Number.isFinite(fee as number) || (fee as number) < 0 || (fee as number) > 1_000_000)) {
    return { ok: false, error: 'bad_fee' }
  }
  const kind: PoolKind = p.kind === 'bluechip' ? 'bluechip' : 'community'
  const managed = p.managed === true
  return {
    ok: true,
    pool: {
      chainId: p.chainId,
      poolId: (p.poolId as string).toLowerCase(),
      currency0: (p.currency0 as string).toLowerCase(),
      currency1: (p.currency1 as string).toLowerCase(),
      fee,
      tickSpacing: p.tickSpacing as number,
      hooks: (p.hooks as string).toLowerCase(),
      vault: (p.vault as string).toLowerCase(),
      kind,
      routing: { exactInputOnly: managed, hasCircuitBreaker: true, dynamicFee },
    },
  }
}

/** Build a manifest from raw operator-supplied entries, dropping (not fabricating) any that don't validate. */
export function buildManifest(rawPools: unknown[]): PoolsManifest {
  const pools: PoolEntry[] = []
  for (const r of rawPools) {
    const n = normalizePool(r)
    if (n.ok) pools.push(n.pool)
  }
  return {
    name: 'Mintware Liquidity',
    version: '1.0.0',
    quoteHint: 'v4 dynamic-fee pools — simulate the swap on-chain (the hook overrides the LP fee per swap).',
    pools,
  }
}

/** Read the operator-configured pools from env (`MINTWARE_POOLS_JSON`, a JSON array). Empty + honest when
 *  unset — the endpoint advertises nothing rather than guessing PoolKeys. */
export function getConfiguredPools(): unknown[] {
  const raw = process.env.MINTWARE_POOLS_JSON
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

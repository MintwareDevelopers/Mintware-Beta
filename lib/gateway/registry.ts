// Multi-pool registry — the app + crons discover every live gateway here instead of a single env
// instance. Pure DB access (takes a service-role client). One isolated gateway per pool.
//
// H-01 (security review 2026-09-06): the registry row is the deposit-routing trust root — the app
// advertises `position_manager` as the deposit target and verifies user txs against it. So before a
// candidate positionManager is trusted, `registerInstance` VERIFIES IT ON-CHAIN (`verifyInstanceOnChain`):
// the contract's own `quoteAsset()` must equal the approved quote asset AND the v4 poolId derived from
// its `poolKey()` must equal the approved pool. A substituted/mistaken address that doesn't actually
// front the approved pool is rejected before any row is written.

import { keccak256, encodeAbiParameters, type PublicClient } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import type { GatewayConfig } from '@/lib/gateway/chain'

type SupabaseClient = ReturnType<typeof getServiceClient>

// A read-only viem client surface — narrowed so tests can pass a mock.
type ReadClient = Pick<PublicClient, 'readContract'>

export type GatewayPoolKey = {
  currency0: `0x${string}`
  currency1: `0x${string}`
  fee: number
  tickSpacing: number
  hooks: `0x${string}`
}

/** Uniswap v4 PoolId = keccak256(abi.encode(PoolKey)) — the canonical on-chain identity of a v4 pool,
 *  matching Solidity `PoolIdLibrary.toId`. GeckoTerminal (and thus `gateway_instances.pool_address`)
 *  keys v4 pools by this id. */
export function computePoolId(k: GatewayPoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
        },
      ],
      [k],
    ),
  )
}

export type VerifyResult =
  | { ok: true; poolId: `0x${string}`; quoteAsset: `0x${string}` }
  | { ok: false; error: string }

/** H-01 trust anchor: read the candidate positionManager on-chain and assert it actually fronts the
 *  APPROVED pool with the APPROVED quote asset. Rejects (never throws) on any mismatch or read failure —
 *  fail-closed, so an unverifiable address is treated as untrusted. */
export async function verifyInstanceOnChain(opts: {
  client: ReadClient
  positionManager: `0x${string}`
  expectedQuoteAsset: string
  expectedPoolAddress: string // the approved pool / poolId the registry keys by (lowercased or not)
}): Promise<VerifyResult> {
  const { client, positionManager } = opts
  const wantQuote = opts.expectedQuoteAsset.toLowerCase()
  const wantPool = opts.expectedPoolAddress.toLowerCase()

  let quoteAsset: `0x${string}`
  let poolKey: GatewayPoolKey
  try {
    quoteAsset = (await client.readContract({
      address: positionManager,
      abi: LP_GATEWAY_ABI,
      functionName: 'quoteAsset',
    })) as `0x${string}`
    const pk = (await client.readContract({
      address: positionManager,
      abi: LP_GATEWAY_ABI,
      functionName: 'poolKey',
    })) as GatewayPoolKey
    poolKey = {
      currency0: pk.currency0,
      currency1: pk.currency1,
      fee: Number(pk.fee),
      tickSpacing: Number(pk.tickSpacing),
      hooks: pk.hooks,
    }
  } catch {
    return { ok: false, error: 'onchain_read_failed' }
  }

  const gotQuote = quoteAsset.toLowerCase()
  if (gotQuote !== wantQuote) return { ok: false, error: 'quote_asset_mismatch' }

  const c0 = poolKey.currency0.toLowerCase()
  const c1 = poolKey.currency1.toLowerCase()
  // internal consistency: the quote asset must be one of the pool's two legs
  if (gotQuote !== c0 && gotQuote !== c1) return { ok: false, error: 'quote_not_in_pool' }

  const poolId = computePoolId(poolKey)
  if (poolId.toLowerCase() !== wantPool) return { ok: false, error: 'pool_mismatch' }

  return { ok: true, poolId, quoteAsset }
}

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
  // H-01: when a read-only chain client is supplied, the positionManager is verified on-chain against
  // the approved pool + quote asset BEFORE the row is written. The sole writer (curate route) always
  // supplies it; a caller that omits it (e.g. a backfill script) skips the check by explicit choice.
  verify?: { client: ReadClient },
): Promise<{ ok: boolean; error?: string }> {
  if (verify?.client) {
    const v = await verifyInstanceOnChain({
      client: verify.client,
      positionManager: i.positionManager as `0x${string}`,
      expectedQuoteAsset: i.quoteAsset,
      expectedPoolAddress: i.poolAddress,
    })
    if (!v.ok) return { ok: false, error: `onchain_verify_failed:${v.error}` }
  }
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

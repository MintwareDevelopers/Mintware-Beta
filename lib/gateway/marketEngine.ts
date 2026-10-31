import { keccak256, isAddress, zeroAddress, erc20Abi, parseAbi, type PublicClient } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { MARKET_ENGINE_ABI, RWA_HOOK_ABI, PERMISSIONS_ADAPTER_ABI, PERMISSIONS_FACTORY_ABI } from '@/lib/web3/artifacts/marketEngine'
import { computePoolId, type ReadClient, type MarketPoolKey } from '@/lib/gateway/registry'
import { MARKET_CHAINS } from '@/lib/chains/marketChains'

type SupabaseClient = ReturnType<typeof getServiceClient>
export const BASE_SEPOLIA_MARKET_ENGINE = '0xc8d6d490da6fa4451311464d154a32d876a3679b' as const
export type MarketEngineConfig = { chainId: number; rpcUrl: string; defaultEngine: `0x${string}` | null }
export type MarketEngineInstance = { id: string; poolAddress: string; chainId: number; pairLabel: string | null; engineAddress: `0x${string}`; quoteAsset: `0x${string}`; token0: `0x${string}`; token1: `0x${string}`; status: 'active' | 'inactive'; verified: boolean }

export function marketEngineConfig(env: Record<string, string | undefined> = process.env): MarketEngineConfig | null {
  const entries = (env.MARKET_ENGINE_INSTANCES ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const tagged = entries.map((entry) => entry.match(/^(\d+):(0x[0-9a-fA-F]{40})$/)).filter(Boolean) as RegExpMatchArray[]
  const chainId = Number(env.MARKET_ENGINE_CHAIN_ID ?? tagged[0]?.[1] ?? '84532')
  const rpcUrl = env.MARKET_ENGINE_RPC_URL ?? (chainId === 84532 ? env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org' : '')
  if (!chainId || !rpcUrl) return null
  const configured = tagged.find((m) => Number(m[1]) === chainId)?.[2] ?? entries.find((entry) => isAddress(entry))
  const addr = configured ?? (tagged.length === 0 && entries.length === 0 && chainId === 84532 ? BASE_SEPOLIA_MARKET_ENGINE : null)
  return { chainId, rpcUrl, defaultEngine: addr && isAddress(addr) ? addr.toLowerCase() as `0x${string}` : null }
}

export type EngineVerification = { ok: true; codeHash: string; owner: string; quoteAsset: `0x${string}`; token0: `0x${string}`; token1: `0x${string}`; poolKey: MarketPoolKey } | { ok: false; error: string }
export async function verifyMarketEngine(opts: { client: ReadClient; address: `0x${string}`; expectedPool?: string | null; expectedOwner?: string | null; allowedCodeHashes?: string[]; allowedOwnedCodeHashes?: string[]; allowInactive?: boolean; chainId?: number }): Promise<EngineVerification> {
  const { client, address } = opts
  const suffix = opts.chainId == null ? '' : `_${opts.chainId}`
  const expectedQuote = process.env[`MARKET_ENGINE_QUOTE_ASSET${suffix}`] ?? process.env.MARKET_ENGINE_QUOTE_ASSET
  const expectedOwner = opts.expectedOwner ?? process.env[`MARKET_ENGINE_OWNER${suffix}`] ?? process.env.MARKET_ENGINE_OWNER
  if (!expectedQuote || !isAddress(expectedQuote)) return { ok: false, error: 'engine_quote_env_unset' }
  if (!client.getCode) return { ok: false, error: 'codehash_unavailable' }
  try {
    const code = await client.getCode({ address })
    if (!code || code === '0x') return { ok: false, error: 'engine_code_missing' }
    const codeHash = keccak256(code).toLowerCase()
    const allow = opts.allowedCodeHashes ?? (process.env[`MARKET_ENGINE_CODEHASHES${suffix}`] ?? process.env.MARKET_ENGINE_CODEHASHES ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
    const ownedAllow = opts.allowedOwnedCodeHashes ?? (process.env[`MARKET_OWNED_ENGINE_CODEHASHES${suffix}`] ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
    const owned = ownedAllow.includes(codeHash)
    if (!allow.includes(codeHash) && !owned) return { ok: false, error: 'engine_codehash_not_allowlisted' }
    const [owner, quote, token0, token1, activated, rawKey] = await Promise.all([
      client.readContract({ address, abi: MARKET_ENGINE_ABI, functionName: 'owner' }),
      client.readContract({ address, abi: MARKET_ENGINE_ABI, functionName: 'quoteAsset' }),
      client.readContract({ address, abi: MARKET_ENGINE_ABI, functionName: 'token0' }),
      client.readContract({ address, abi: MARKET_ENGINE_ABI, functionName: 'token1' }),
      client.readContract({ address, abi: MARKET_ENGINE_ABI, functionName: 'activated' }),
      client.readContract({ address, abi: MARKET_ENGINE_ABI, functionName: 'poolKey' }),
    ])
    const key = Array.isArray(rawKey)
      ? { currency0: rawKey[0], currency1: rawKey[1], fee: rawKey[2], tickSpacing: rawKey[3], hooks: rawKey[4] } as MarketPoolKey
      : rawKey as MarketPoolKey
    const normalized = { currency0: key.currency0.toLowerCase() as `0x${string}`, currency1: key.currency1.toLowerCase() as `0x${string}`, fee: Number(key.fee), tickSpacing: Number(key.tickSpacing), hooks: key.hooks.toLowerCase() as `0x${string}` }
    if (!activated && !opts.allowInactive) return { ok: false, error: 'engine_inactive' }
    if (!expectedOwner) return { ok: false, error: 'engine_owner_unconfigured' }
    if (String(owner).toLowerCase() !== expectedOwner.toLowerCase()) return { ok: false, error: 'engine_owner_mismatch' }
    if (owned) {
      // An explicitly approved concrete owned wrapper is the trust root; never infer ownership from a hook.
      if (opts.chainId !== 84532 || String(quote).toLowerCase() !== BASE_SEPOLIA_USDC) return { ok: false, error: 'owned_engine_quote_mismatch' }
      const read = (target: `0x${string}`, abi: typeof MARKET_ENGINE_ABI | typeof RWA_HOOK_ABI | typeof PERMISSIONS_ADAPTER_ABI | typeof PERMISSIONS_FACTORY_ABI, functionName: string, args?: unknown[]) => client.readContract({ address: target, abi, functionName, ...(args ? { args } : {}) })
      const [hook, adapter, mark, manager] = await Promise.all(['appraisalHook','permissionsAdapter','nonQuoteMark','poolManager'].map((name) => read(address, MARKET_ENGINE_ABI, name)))
      const h = String(hook).toLowerCase() as `0x${string}`
      const a = String(adapter).toLowerCase() as `0x${string}`
      if (h === zeroAddress || h !== normalized.hooks || h !== String(mark).toLowerCase() || normalized.fee !== 0x800000) return { ok: false, error: 'owned_engine_hook_mismatch' }
      const [factory, hookAdapter, boundEngine, hookAsset, hookQuote, hookManager, pinnedPool, underlying, adapterManager] = await Promise.all([
        ...['permissionsFactory','permissionsAdapter','vault','asset','quoteAsset','poolManager','expectedPoolId'].map((name) => read(h,RWA_HOOK_ABI,name)),
        read(a,PERMISSIONS_ADAPTER_ABI,'PERMISSIONED_TOKEN'), read(a,PERMISSIONS_ADAPTER_ABI,'POOL_MANAGER'),
      ])
      const verified = await read(String(factory) as `0x${string}`,PERMISSIONS_FACTORY_ABI,'verifiedPermissionsAdapterOf',[a])
      const asset = String(underlying).toLowerCase()
      const q = String(quote).toLowerCase()
      if (asset === zeroAddress || asset === q || String(verified).toLowerCase() !== asset || String(hookAsset).toLowerCase() !== asset
        || String(hookAdapter).toLowerCase() !== a || String(boundEngine).toLowerCase() !== address.toLowerCase()
        || String(hookQuote).toLowerCase() !== q || String(hookManager).toLowerCase() !== String(manager).toLowerCase()
        || String(adapterManager).toLowerCase() !== String(manager).toLowerCase() || String(pinnedPool).toLowerCase() !== computePoolId(normalized).toLowerCase()
        || (normalized.currency0 !== a && normalized.currency1 !== a)
        || String(token0).toLowerCase() !== (normalized.currency0 === a ? asset : q)
        || String(token1).toLowerCase() !== (normalized.currency1 === a ? asset : q)) return { ok: false, error: 'owned_engine_mapping_mismatch' }
    } else if (normalized.hooks !== zeroAddress || String(token0).toLowerCase() !== normalized.currency0 || String(token1).toLowerCase() !== normalized.currency1) return { ok: false, error: 'engine_token_mismatch' }
    const q = String(quote).toLowerCase()
    if (q !== normalized.currency0 && q !== normalized.currency1) return { ok: false, error: 'engine_quote_mismatch' }
    if (q !== expectedQuote.toLowerCase()) return { ok: false, error: 'engine_quote_asset_not_allowlisted' }
    const poolId = computePoolId(normalized)
    if (opts.expectedPool && poolId.toLowerCase() !== opts.expectedPool.toLowerCase()) return { ok: false, error: 'engine_pool_mismatch' }
    return { ok: true, codeHash, owner: String(owner).toLowerCase(), quoteAsset: q as `0x${string}`, token0: String(token0).toLowerCase() as `0x${string}`, token1: String(token1).toLowerCase() as `0x${string}`, poolKey: normalized }
  } catch {
    return { ok: false, error: 'engine_onchain_read_failed' }
  }
}

export async function listMarketEngines(db: SupabaseClient, chainId: number, activeOnly = true): Promise<MarketEngineInstance[]> {
  let query = db.from('gateway_instances').select('*').not('market_engine_address', 'is', null).eq('chain_id', chainId)
  if (activeOnly) query = query.eq('status', 'active')
  const { data, error } = await query
  if (error) throw new Error(`market engine registry read failed: ${error.message}`)
  return (data ?? []).map((r: Record<string, unknown>) => ({ id: String(r.id), poolAddress: String(r.pool_address).toLowerCase(), chainId: Number(r.chain_id), pairLabel: r.pair_label == null ? null : String(r.pair_label), engineAddress: String(r.market_engine_address).toLowerCase() as `0x${string}`, quoteAsset: String(r.quote_asset).toLowerCase() as `0x${string}`, token0: String(r.market_engine_token0).toLowerCase() as `0x${string}`, token1: String(r.market_engine_token1).toLowerCase() as `0x${string}`, status: r.status === 'inactive' ? 'inactive' : 'active', verified: Boolean(r.engine_verified_at && r.market_engine_code_hash && r.market_engine_owner) }))
}

export async function resolveMarketEngine(db: SupabaseClient, cfg: MarketEngineConfig, pool: string | null, includeInactive = false, engineAddress?: string | null): Promise<(MarketEngineInstance & { source: 'registry' | 'env-fallback'; live: boolean }) | null> {
  const all = await listMarketEngines(db, cfg.chainId, false)
  if (all.length) {
    const address = engineAddress?.toLowerCase()
    // An explicit generation is an unambiguous registry lookup and must remain resolvable for exits.
    // Without one, a retired pool's inactive engine is the fallback when that pool has no active engine
    // (other pools being live must not hide it); without a pool, only when the chain has no active engine.
    let eligible = address && includeInactive
      ? all.filter((x) => x.engineAddress === address)
      : all.filter((x) => x.status === 'active')
    if (pool) eligible = eligible.filter((x) => x.poolAddress === pool.toLowerCase())
    if (eligible.length === 0 && includeInactive && !address && (pool || !all.some((x) => x.status === 'active'))) {
      eligible = all.filter((x) => x.status === 'inactive' && (!pool || x.poolAddress === pool.toLowerCase()))
    }
    if (!pool && eligible.length !== 1) return null
    if (pool && eligible.length !== 1) return null
    const hit = eligible.find((x) => !pool || x.poolAddress === pool.toLowerCase())
    return hit ? { ...hit, source: 'registry', live: hit.status === 'active' } : null
  }
  if (!cfg.defaultEngine) return null
  const client = (await import('@/lib/gateway/chain')).marketEnginePublicClient({ chainId: cfg.chainId, rpcUrl: cfg.rpcUrl })
  const verified = await verifyMarketEngine({ client, address: cfg.defaultEngine, expectedPool: pool, chainId: cfg.chainId })
  if (!verified.ok) return null
  const poolAddress = computePoolId(verified.poolKey).toLowerCase()
  return { id: 'env-market-engine', poolAddress, chainId: cfg.chainId, pairLabel: null, engineAddress: cfg.defaultEngine, quoteAsset: verified.quoteAsset, token0: verified.token0, token1: verified.token1, status: 'active', verified: true, source: 'env-fallback', live: false }
}

/** Every market chain this deployment reads: its configured chain (its own RPC) plus the other market chains
 *  (Base + Robinhood) on their public RPCs. */
export function marketEngineConfigs(env: Record<string, string | undefined> = process.env): MarketEngineConfig[] {
  const cfg = marketEngineConfig(env)
  const others = Object.values(MARKET_CHAINS).filter((c) => c.id !== cfg?.chainId).map((c) => ({ chainId: c.id, rpcUrl: c.rpc, defaultEngine: null }))
  return cfg ? [cfg, ...others] : others
}

/** The chain a pool's market lives on, from the registry (a v4 poolId commits to its tokens, so it is unique
 *  across chains). Falls back to the configured chain when the pool is unregistered or ambiguous, which keeps
 *  every pre-existing single-chain behaviour (incl. the env-configured engine) unchanged. */
export async function marketEngineConfigForPool(db: SupabaseClient, pool: string | null | undefined, env: Record<string, string | undefined> = process.env): Promise<MarketEngineConfig | null> {
  const cfg = marketEngineConfig(env)
  if (!pool) return cfg
  const { data, error } = await db.from('gateway_instances').select('chain_id').eq('pool_address', pool.toLowerCase()).not('market_engine_address', 'is', null)
  if (error) throw new Error(`market engine registry read failed: ${error.message}`)
  const chains = [...new Set((data ?? []).map((r: { chain_id: number }) => Number(r.chain_id)))]
  if (chains.length !== 1 || chains[0] === cfg?.chainId) return cfg
  return marketEngineConfigs(env).find((c) => c.chainId === chains[0]) ?? cfg
}

export const BASE_SEPOLIA_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as const

/** Shared engine reads, all at the caller's block. Values remain decimal strings without precision loss. */
export async function readMarketEngineSnapshot(client: Pick<PublicClient, 'readContract'>, address: `0x${string}`, blockNumber: bigint, account?: `0x${string}`) {
  const read = (functionName: 'totalNav' | 'totalSupply' | 'token0' | 'token1' | 'adapter0' | 'adapter1' | 'positionLiquidity' | 'tickLower' | 'tickUpper' | 'activated') => client.readContract({ address, abi: MARKET_ENGINE_ABI, functionName, blockNumber })
  const [nav, supply, token0, token1, adapter0, adapter1, liquidity, lower, upper, activated, shares] = await Promise.all([
    // A stale mark may block NAV while full in-kind exits remain available.
    read('totalNav').catch(() => null), read('totalSupply'), read('token0'), read('token1'), read('adapter0'), read('adapter1'),
    read('positionLiquidity'), read('tickLower'), read('tickUpper'), read('activated'),
    account ? client.readContract({ address, abi: MARKET_ENGINE_ABI, functionName: 'balanceOf', args: [account], blockNumber }) : null,
  ])
  const balances = await Promise.all(([token0,token1] as `0x${string}`[]).map(async (token, i) => {
    const [balance, idle, decimals, wallet] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address], blockNumber }),
      client.readContract({ address: (i === 0 ? adapter0 : adapter1) as `0x${string}`, abi: parseAbi(['function totalAssets() view returns (uint256)']), functionName: 'totalAssets', blockNumber }),
      client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals', blockNumber }),
      account ? client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account], blockNumber }) : null,
    ])
    return { token, decimals, engine: balance.toString(), idle: idle.toString(), wallet: wallet?.toString() ?? null }
  }))
  return { address, activated: Boolean(activated), nav: nav?.toString() ?? null, supply: supply.toString(), shares: shares?.toString() ?? null,
    balances, position: { liquidity: liquidity.toString(), tickLower: Number(lower), tickUpper: Number(upper) } }
}

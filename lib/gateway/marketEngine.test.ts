import { afterEach, describe, expect, it } from 'vitest'
import { keccak256 } from 'viem'
import { computePoolId } from '@/lib/gateway/registry'
import { marketEngineConfig, marketEngineConfigForPool, marketEngineConfigs, verifyMarketEngine, BASE_SEPOLIA_MARKET_ENGINE, resolveMarketEngine } from '@/lib/gateway/marketEngine'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const ENGINE = '0x' + 'aa'.repeat(20) as `0x${string}`
const OWNER = '0x' + 'bb'.repeat(20)
const TOKEN0 = '0x' + '11'.repeat(20) as `0x${string}`
const TOKEN1 = '0x' + '22'.repeat(20) as `0x${string}`
const CODE = '0x60006000' as `0x${string}`
const KEY = { currency0: TOKEN0, currency1: TOKEN1, fee: 3000, tickSpacing: 60, hooks: '0x' + '00'.repeat(20) as `0x${string}` }
const client = {
  getCode: async () => CODE,
  readContract: async ({ functionName }: { functionName: string }): Promise<unknown> => ({ owner: OWNER, quoteAsset: TOKEN1, token0: TOKEN0, token1: TOKEN1, activated: true, poolKey: KEY })[functionName],
}
afterEach(() => { delete process.env.MARKET_ENGINE_QUOTE_ASSET })

describe('verifyMarketEngine', () => {
  it('uses the requested Base Sepolia engine default while allowing chain/instance overrides', () => {
    expect(marketEngineConfig({})).toEqual({ chainId: 84532, rpcUrl: 'https://sepolia.base.org', defaultEngine: BASE_SEPOLIA_MARKET_ENGINE })
    expect(marketEngineConfig({ MARKET_ENGINE_CHAIN_ID: '46630', MARKET_ENGINE_RPC_URL: 'https://rh.test', MARKET_ENGINE_INSTANCES: '46630:0x' + 'cc'.repeat(20) })).toEqual({ chainId: 46630, rpcUrl: 'https://rh.test', defaultEngine: '0x' + 'cc'.repeat(20) })
  })
  it('requires allowlisted runtime code, the configured quote, owner, activation, and exact pool key', async () => {
    process.env.MARKET_ENGINE_QUOTE_ASSET = TOKEN1
    const codeHash = keccak256(CODE)
    const result = await verifyMarketEngine({ client, address: ENGINE, expectedPool: computePoolId(KEY), expectedOwner: OWNER, allowedCodeHashes: [codeHash] })
    expect(result).toMatchObject({ ok: true, codeHash, owner: OWNER, quoteAsset: TOKEN1, token0: TOKEN0, token1: TOKEN1 })
  })
  it('fails closed when quote trust is not configured or code is not allowlisted', async () => {
    expect((await verifyMarketEngine({ client, address: ENGINE, expectedPool: computePoolId(KEY), expectedOwner: OWNER, allowedCodeHashes: [keccak256(CODE)] })).ok).toBe(false)
    process.env.MARKET_ENGINE_QUOTE_ASSET = TOKEN1
    expect(await verifyMarketEngine({ client, address: ENGINE, expectedPool: computePoolId(KEY), expectedOwner: OWNER, allowedCodeHashes: [] })).toMatchObject({ ok: false, error: 'engine_codehash_not_allowlisted' })
  })
})

const poolA = '0x' + 'aa'.repeat(32)
const poolB = '0x' + 'bb'.repeat(32)
const engineA = '0x' + '11'.repeat(20)
const engineB = '0x' + '22'.repeat(20)
const row = (pool_address: string, market_engine_address: string, status: 'active' | 'inactive') => ({
  id: market_engine_address, pool_address, chain_id: 84532, pair_label: null,
  market_engine_address, quote_asset: '0x' + '33'.repeat(20), market_engine_token0: '0x' + '44'.repeat(20),
  market_engine_token1: '0x' + '33'.repeat(20), status, engine_verified_at: 'verified',
  market_engine_code_hash: '0x' + '55'.repeat(32), market_engine_owner: '0x' + '66'.repeat(20),
})
const cfg = { chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }

describe('resolveMarketEngine inactive resolution', () => {
  it('resolves an explicitly named retired engine while another pool remains active', async () => {
    const { client: db } = fakeSupabase({ tables: { gateway_instances: [row(poolA, engineA, 'inactive'), row(poolB, engineB, 'active')] } })
    const resolved = await resolveMarketEngine(db, cfg, poolA, true, engineA)
    expect(resolved).toMatchObject({ engineAddress: engineA, status: 'inactive', live: false })
  })

  it('uses inactive rows only when no active engine exists anywhere on chain', async () => {
    const { client: db } = fakeSupabase({ tables: { gateway_instances: [row(poolA, engineA, 'inactive'), row(poolB, engineB, 'inactive')] } })
    expect(await resolveMarketEngine(db, cfg, poolA, true)).toMatchObject({ engineAddress: engineA, live: false })
    expect(await resolveMarketEngine(db, cfg, null, true)).toBeNull()
  })

  it('resolves a retired pool by pool alone while another pool remains active (exits stay reachable)', async () => {
    const { client: db } = fakeSupabase({ tables: { gateway_instances: [row(poolA, engineA, 'inactive'), row(poolB, engineB, 'active')] } })
    expect((await resolveMarketEngine(db, cfg, poolA, true))?.engineAddress).toBe(engineA)
    expect(await resolveMarketEngine(db, cfg, poolA, false)).toBeNull()
  })

  it('returns null when a retired pool has several inactive generations and none is named', async () => {
    const engineC = '0x' + 'c'.repeat(40)
    const { client: db } = fakeSupabase({ tables: { gateway_instances: [row(poolA, engineA, 'inactive'), row(poolA, engineC, 'inactive'), row(poolB, engineB, 'active')] } })
    expect(await resolveMarketEngine(db, cfg, poolA, true)).toBeNull()
  })

  it('returns null for ambiguous active engines when no pool is specified', async () => {
    const { client: db } = fakeSupabase({ tables: { gateway_instances: [row(poolA, engineA, 'active'), row(poolB, engineB, 'active')] } })
    expect(await resolveMarketEngine(db, cfg, null)).toBeNull()
  })
})

describe('marketEngineConfigForPool', () => {
  const RH_ENV = { MARKET_ENGINE_CHAIN_ID: '46630', MARKET_ENGINE_RPC_URL: 'https://rh.test', MARKET_ENGINE_INSTANCES: '46630:0x' + 'cc'.repeat(20) }
  const reg = (pool: string, chain_id: number) => ({ pool_address: pool, chain_id, market_engine_address: '0x' + 'dd'.repeat(20) })
  const BASE_POOL = '0x' + 'b1'.repeat(32)
  const RH_POOL = '0x' + 'a1'.repeat(32)

  it('routes a pool registered on another market chain to that chain’s public RPC', async () => {
    const { client: db } = fakeSupabase({ tables: { gateway_instances: [reg(BASE_POOL, 84532), reg(RH_POOL, 46630)] } })
    expect(await marketEngineConfigForPool(db, BASE_POOL, RH_ENV)).toEqual({ chainId: 84532, rpcUrl: 'https://base-sepolia-rpc.publicnode.com', defaultEngine: null })
  })

  it('keeps the configured chain (and its env engine) for its own pools, unknown pools and no pool', async () => {
    const { client: db } = fakeSupabase({ tables: { gateway_instances: [reg(BASE_POOL, 84532), reg(RH_POOL, 46630)] } })
    const cfg = marketEngineConfig(RH_ENV)
    expect(await marketEngineConfigForPool(db, RH_POOL, RH_ENV)).toEqual(cfg)
    expect(await marketEngineConfigForPool(db, '0x' + 'ee'.repeat(32), RH_ENV)).toEqual(cfg)
    expect(await marketEngineConfigForPool(db, null, RH_ENV)).toEqual(cfg)
  })

  it('lists the configured chain first, then the other market chain', () => {
    expect(marketEngineConfigs(RH_ENV).map((c) => c.chainId)).toEqual([46630, 84532])
  })
})

describe('owned-pool engine verification', () => {
  const HOOK = '0x' + '44'.repeat(20) as `0x${string}`
  const ADAPTER = '0x' + '55'.repeat(20) as `0x${string}`
  const FACTORY = '0x' + '66'.repeat(20) as `0x${string}`
  const MANAGER = '0x' + '77'.repeat(20) as `0x${string}`
  const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as const
  const ownedKey = { currency0: USDC, currency1: ADAPTER, fee: 0x800000, tickSpacing: 60, hooks: HOOK }
  const values = () => ({
    [ENGINE]: { owner: OWNER, quoteAsset: USDC, token0: USDC, token1: TOKEN0, activated: true, poolKey: ownedKey, appraisalHook: HOOK, permissionsAdapter: ADAPTER, nonQuoteMark: HOOK, poolManager: MANAGER },
    [HOOK]: { permissionsFactory: FACTORY, permissionsAdapter: ADAPTER, vault: ENGINE, asset: TOKEN0, quoteAsset: USDC, poolManager: MANAGER, expectedPoolId: computePoolId(ownedKey) },
    [ADAPTER]: { PERMISSIONED_TOKEN: TOKEN0, POOL_MANAGER: MANAGER },
    [FACTORY]: { verifiedPermissionsAdapterOf: TOKEN0 },
  } as Record<string, Record<string, unknown>>)
  const check = (facts = values(), extra = {}) => {
    process.env.MARKET_ENGINE_QUOTE_ASSET = USDC
    return verifyMarketEngine({ client: { getCode: async () => CODE, readContract: async ({ address, functionName }: { address: string; functionName: string }) => facts[address]?.[functionName] },
      address: ENGINE, expectedOwner: OWNER, allowedCodeHashes: [], allowedOwnedCodeHashes: [keccak256(CODE)], chainId: 84532, ...extra })
  }
  it('maps the verified adapter to underlying in pool order', async () => {
    expect(await check()).toMatchObject({ ok: true, token0: USDC, token1: TOKEN0 })
    const facts = values()
    const key = { ...ownedKey, currency0: ADAPTER, currency1: USDC }
    facts[ENGINE].poolKey = key; facts[ENGINE].token0 = TOKEN0; facts[ENGINE].token1 = USDC
    facts[HOOK].expectedPoolId = computePoolId(key)
    expect(await check(facts)).toMatchObject({ ok: true, token0: TOKEN0, token1: USDC })
  })
  it('does not admit hooked engines through the ordinary codehash list', async () => {
    expect(await check(values(), { allowedOwnedCodeHashes: [], allowedCodeHashes: [keccak256(CODE)] })).toMatchObject({ ok: false, error: 'engine_token_mismatch' })
  })
  it.each([
    [FACTORY, 'verifiedPermissionsAdapterOf', TOKEN1],
    [HOOK, 'asset', TOKEN1], [HOOK, 'vault', OWNER], [HOOK, 'permissionsAdapter', TOKEN1],
    [HOOK, 'poolManager', OWNER], [ADAPTER, 'POOL_MANAGER', OWNER], [ADAPTER, 'PERMISSIONED_TOKEN', USDC],
    [ENGINE, 'token1', ADAPTER], [HOOK, 'expectedPoolId', '0x' + '00'.repeat(32)],
  ])('refuses a broken binding at %s.%s', async (address, field, value) => {
    const facts = values(); facts[address][field] = value
    expect(await check(facts)).toMatchObject({ ok: false, error: 'owned_engine_mapping_mismatch' })
  })
  it('keeps the quote anchored to chain USDC and testnet', async () => {
    expect(await check(values(), { chainId: 1 })).toMatchObject({ ok: false, error: 'owned_engine_quote_mismatch' })
    const facts = values(); facts[ENGINE].quoteAsset = TOKEN1
    expect(await check(facts)).toMatchObject({ ok: false, error: 'owned_engine_quote_mismatch' })
  })
  it('only permits inactive engines for explicit read-only inspection', async () => {
    const facts = values(); facts[ENGINE].activated = false
    expect(await check(facts)).toMatchObject({ ok: false, error: 'engine_inactive' })
    expect(await check(facts, { allowInactive: true })).toMatchObject({ ok: true })
  })
})

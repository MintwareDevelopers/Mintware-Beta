import { afterEach, describe, expect, it } from 'vitest'
import { keccak256 } from 'viem'
import { computePoolId } from '@/lib/gateway/registry'
import { marketEngineConfig, verifyMarketEngine, BASE_SEPOLIA_MARKET_ENGINE, resolveMarketEngine } from '@/lib/gateway/marketEngine'
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

import { afterEach, describe, expect, it } from 'vitest'
import { keccak256 } from 'viem'
import { computePoolId } from '@/lib/gateway/registry'
import { marketEngineConfig, verifyMarketEngine, BASE_SEPOLIA_MARKET_ENGINE } from '@/lib/gateway/marketEngine'

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

import { afterEach, expect, it, vi } from 'vitest'
import { readRwaUnit } from './read'
import { readMarketEngineSnapshot, verifyMarketEngine } from '@/lib/gateway/marketEngine'
vi.mock('@/lib/gateway/marketEngine', () => ({ readMarketEngineSnapshot: vi.fn(), verifyMarketEngine: vi.fn() }))
const engine = '0x1111111111111111111111111111111111111111' as const
const hook = '0x2222222222222222222222222222222222222222' as const
const adapter = '0x3333333333333333333333333333333333333333' as const
const account = '0x4444444444444444444444444444444444444444' as const
const calls: Record<string, unknown>[] = []
const client = {
  getBlock: async () => ({ number: 123n, timestamp: 9000n }),
  getCode: vi.fn(async () => '0x6000' as const),
  readContract: vi.fn(async (args: Record<string, unknown>) => {
    calls.push(args)
    return ({ latestMark: [100n * 10n ** 18n, 1000n], bandStatus: [230280, 230280, 0n, true, true, false],
      config: [500, 1500, 1000, 3600, 600, 3000, 10000, 2000, 604800], oracleReady: true,
      tradingPaused: false, permissionsAdapter: adapter, allowedWrappers: true, isAllowed: false, swappingEnabled: true } as Record<string, unknown>)[String(args.functionName)]
  }),
}
afterEach(() => { vi.clearAllMocks(); calls.length = 0 })
it('pins verification, balances, appraisal and permission reads to one block; never refreshes stale observations', async () => {
  vi.mocked(verifyMarketEngine).mockImplementation(async ({ client: pinned }) => {
    await pinned.getCode!({ address: engine })
    await pinned.readContract({ address: engine, functionName: 'owner' })
    return { ok: true, codeHash: 'hash', owner: account, quoteAsset: adapter, token0: adapter, token1: account,
      poolKey: { currency0: adapter, currency1: account, fee: 0x800000, tickSpacing: 60, hooks: hook } }
  })
  vi.mocked(readMarketEngineSnapshot).mockResolvedValue({ address: engine, activated: true, nav: null, supply: '10', shares: '5', balances: [], position: { liquidity: '1', tickLower: 0, tickUpper: 60 } })
  const result = await readRwaUnit(client as unknown as Parameters<typeof readRwaUnit>[0], engine, account)
  expect(result.hook).toMatchObject({ observedAt: 1000, fresh: false, oracleReady: true, permissions: { accountSwap: false, accountLiquidity: false } })
  expect(result.engine.nav).toBeNull()
  expect(result.blockTime).toBe(9000)
  expect(calls.every((c) => c.blockNumber === 123n)).toBe(true)
  expect(client.getCode).toHaveBeenCalledWith({ address: engine, blockNumber: 123n })
  expect(readMarketEngineSnapshot).toHaveBeenCalledWith(client, engine, 123n, account)
  expect(calls.filter((c) => c.functionName === 'isAllowed').map((c) => c.args)).toEqual([[engine, '0x0002'], [account, '0x0001'], [account, '0x0002']])
})
it('refuses an unverified engine before reading market facts', async () => {
  vi.mocked(verifyMarketEngine).mockResolvedValue({ ok: false, error: 'engine_codehash_not_allowlisted' })
  await expect(readRwaUnit(client as unknown as Parameters<typeof readRwaUnit>[0], engine)).rejects.toThrow('engine_codehash_not_allowlisted')
  expect(readMarketEngineSnapshot).not.toHaveBeenCalled()
  expect(calls).toHaveLength(0)
})

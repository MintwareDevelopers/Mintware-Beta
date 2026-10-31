import { beforeEach, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const state = vi.hoisted(() => ({ reads: vi.fn(), unavailable: 'totalNav' }))
const POOL = '0x' + 'ab'.repeat(32)
const WALLET = '0x' + '44'.repeat(20)
vi.mock('@/lib/gateway/marketEngine', () => {
  const cfg = { chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }
  const inst = {
    id: 'engine', poolAddress: '0x' + 'ab'.repeat(32), chainId: 84532, pairLabel: 'WETH / USDC',
    engineAddress: '0x' + '11'.repeat(20), verified: true, status: 'active', source: 'registry', live: true,
  }
  return {
    marketEngineConfig: () => cfg, marketEngineConfigForPool: async () => cfg, marketEngineConfigs: () => [cfg],
    resolveMarketEngine: async () => inst, listMarketEngines: async () => [inst],
  }
})
vi.mock('@/lib/gateway/chain', () => ({ marketEnginePublicClient: () => ({ readContract: state.reads }) }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => fakeSupabase().client }))
const req = (url: string) => {
  const request = new Request(url)
  Object.assign(request, { nextUrl: new URL(url) })
  return request as never
}

beforeEach(() => {
  state.unavailable = 'totalNav'
  state.reads = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === state.unavailable) throw new Error('StaleMark or unavailable read')
    return functionName === 'balanceOf' ? 2_000_000_000_000_000_000n : 10_000_000_000_000_000_000n
  })
})

it.each(['totalNav', 'totalSupply'])('MW-05: unavailable %s preserves readable shares and null value', async (unavailable) => {
  state.unavailable = unavailable
  const { GET } = await import('./route')
  const res = await GET(req(`https://mw.test/api/gateway/position?pool=${POOL}&address=${WALLET}`))
  const body = await res.json()
  expect(res.status).toBe(200)
  expect(body.position).toMatchObject({ shares: '2000000000000000000', positionValueAtomic: null, valuationAvailable: false })
  expect(body[unavailable]).toBeNull()
})

it.each(['totalNav', 'totalSupply'])('MW-05: portfolio retains funded markets when %s is unavailable', async (unavailable) => {
  state.unavailable = unavailable
  const { GET } = await import('../positions/route')
  const res = await GET(req(`https://mw.test/api/gateway/positions?address=${WALLET}`))
  const body = await res.json()
  expect(res.status).toBe(200)
  expect(body.positions).toHaveLength(1)
  expect(body.positions[0]).toMatchObject({ shares: '2000000000000000000', positionValueAtomic: null, valuationAvailable: false })
  expect(body.complete).toBe(true)
  expect(body.failedPools).toEqual([])
})

it('MW-05: an unreadable balance remains a read failure, never a zero position', async () => {
  state.unavailable = 'balanceOf'
  const { GET } = await import('./route')
  const res = await GET(req(`https://mw.test/api/gateway/position?pool=${POOL}&address=${WALLET}`))
  expect(res.status).toBe(502)
  expect(await res.json()).toMatchObject({ error: 'chain_read_failed' })
  const { GET: positions } = await import('../positions/route')
  const body = await (await positions(req(`https://mw.test/api/gateway/positions?address=${WALLET}`))).json()
  expect(body.complete).toBe(false)
  expect(body.failedPools).toContain(POOL)
})

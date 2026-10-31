import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, engines: [] as any[], receipt: null as any }))
const ACCOUNT = '0x' + 'aa'.repeat(20)
const ENGINE = '0x' + '11'.repeat(20)
const POOL = '0x' + 'bb'.repeat(32)
const TX = '0x' + '12'.repeat(32)
vi.mock('@/lib/web2/routeHandler', () => ({ createHandler: (fn: any) => (req: any) => fn(req, { user: { address: ACCOUNT }, supabase: state.db.client, json: (body: unknown, status = 200) => Response.json(body, { status }), log: { warn: vi.fn(), error: vi.fn() } }) }))
vi.mock('@/lib/gateway/marketEngine', () => ({ marketEngineConfig: () => ({ chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }), marketEngineConfigForPool: async () => ({ chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }), marketEngineConfigs: () => [({ chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null })], listMarketEngines: async () => state.engines, resolveMarketEngine: async () => null }))
vi.mock('@/lib/gateway/chain', () => ({ marketEnginePublicClient: () => ({ getTransactionReceipt: async () => state.receipt, readContract: async () => 8n }) }))
vi.mock('@/lib/gateway/recordAuth', () => ({ bindSignedRecord: () => ({ ok: true, bound: { txHash: TX, pool: POOL } }) }))

const engine = { id: 'e1', poolAddress: POOL, chainId: 84532, pairLabel: null, engineAddress: ENGINE, quoteAsset: ACCOUNT, token0: ACCOUNT, token1: ENGINE, status: 'inactive', verified: true }
function withdrawLog() {
  return {
    address: ENGINE,
    topics: encodeEventTopics({ abi: [{ type: 'event', name: 'Withdrawn', inputs: [{ name: 'account', type: 'address', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'sharesBurned', type: 'uint256', indexed: false }, { name: 'amount0', type: 'uint256', indexed: false }, { name: 'amount1', type: 'uint256', indexed: false }] }], eventName: 'Withdrawn', args: { account: ACCOUNT as `0x${string}`, recipient: ACCOUNT as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [9n, 100n, 0n]),
  }
}

beforeEach(() => {
  state.db = fakeSupabase({ uniques: { market_engine_tx_events: [['tx_hash']] } })
  state.engines = [engine]
  state.receipt = { status: 'success', to: '0x' + 'cc'.repeat(20), logs: [withdrawLog()], blockNumber: 10n, transactionIndex: 2 }
})

describe('POST /api/gateway/withdraw — signed MarketEngine receipt record', () => {
  it('records the engine Withdrawn event from a smart-account receipt', async () => {
    const { POST } = await import('./route')
    const res = await POST(new NextRequest('https://mw.test/api/gateway/withdraw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: TX, pool: POOL }) }))
    expect(res.status).toBe(200)
    expect((await res.json()).sharesBurned).toBe('9')
    expect(state.db.db.tables.market_engine_tx_events[0]).toMatchObject({ market_engine_address: ENGINE, user_wallet: ACCOUNT, action: 'withdraw' })
  })
})

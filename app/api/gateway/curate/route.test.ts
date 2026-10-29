import { beforeEach, describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { buildGatewayCurateMessage } from '@/lib/gateway/curateAuth'

const verify = vi.hoisted(() => vi.fn())
const saved: Record<string, Record<string, unknown>[]> = { gateway_pool_requests: [], gateway_instances: [], gateway_instance_history: [] }
vi.mock('@/lib/gateway/registry', () => ({ deactivateInstance: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/gateway/marketEngine', () => ({ marketEngineConfig: () => ({ chainId: 84532, rpcUrl: 'https://rpc.test', defaultEngine: null }), verifyMarketEngine: (...args: unknown[]) => verify(...args) }))
vi.mock('@/lib/gateway/chain', () => ({ gatewayPublicClient: () => ({ readContract: vi.fn() }) }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => ({ from(table: string) {
  const filters: [string, unknown][] = []
  let mode = 'select'; let payload: Record<string, unknown> = {}
  const rows = saved[table] ?? (saved[table] = [])
  const hit = () => rows.filter((r) => filters.every(([k, v]) => String(r[k]) === String(v)))
  const q = {
    select: () => q, order: () => q, limit: () => q,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
    maybeSingle: async () => ({ data: hit()[0] ?? null, error: null }),
    insert: (value: Record<string, unknown>) => { mode = 'insert'; payload = value; return q },
    update: (value: Record<string, unknown>) => { mode = 'update'; payload = value; return q },
    then: (resolve: (v: unknown) => unknown) => {
      if (mode === 'insert') rows.push(payload)
      if (mode === 'update') hit().forEach((r) => Object.assign(r, payload))
      return Promise.resolve({ data: rows, error: null }).then(resolve)
    },
  }
  return q
} }) }))

import { POST } from './route'
const curator = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const POOL = '0x' + 'ab'.repeat(32)
const ENGINE = '0x' + 'cd'.repeat(20)

function req(body: unknown) { return new Request('https://mw.test/api/gateway/curate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never }
async function signedRegister() {
  const issuedAt = Date.now()
  const authMessage = buildGatewayCurateMessage({ address: curator.address, issuedAt, curateAction: 'approve', requestId: 'req-1', poolAddress: POOL, chainId: 84532, marketEngineAddress: ENGINE })
  const authSignature = await curator.signMessage({ message: authMessage })
  return { address: curator.address, issuedAt, authMessage, authSignature, action: 'approve', requestId: 'req-1', poolAddress: POOL, chainId: 84532, instance: { marketEngineAddress: ENGINE } }
}

beforeEach(() => {
  process.env.LP_GATEWAY_CURATORS = curator.address
  process.env.MARKET_ENGINE_OWNER = '0x' + '55'.repeat(20)
  saved.gateway_pool_requests = [{ id: 'req-1', pool_address: POOL, chain_id: 84532, pair_label: 'A / USDG', status: 'pending' }]
  saved.gateway_instances = []
  saved.gateway_instance_history = []
  verify.mockResolvedValue({ ok: true, codeHash: '0x' + '44'.repeat(32), owner: process.env.MARKET_ENGINE_OWNER.toLowerCase(), quoteAsset: '0x' + '22'.repeat(20), token0: '0x' + '11'.repeat(20), token1: '0x' + '22'.repeat(20) })
})

describe('POST /api/gateway/curate — MarketEngine registration', () => {
  it('verifies the signed engine address before marking the pool active', async () => {
    const res = await POST(req(await signedRegister()))
    expect(res.status).toBe(200)
    expect(saved.gateway_instances[0]).toMatchObject({ market_engine_address: ENGINE, status: 'active', market_engine_code_hash: '0x' + '44'.repeat(32) })
    expect(saved.gateway_pool_requests[0].status).toBe('approved')
  })
  it('keeps an unverified candidate non-depositable', async () => {
    verify.mockResolvedValue({ ok: false, error: 'engine_codehash_not_allowlisted' })
    const res = await POST(req(await signedRegister()))
    expect(res.status).toBe(400)
    expect(saved.gateway_instances).toHaveLength(0)
    expect(saved.gateway_pool_requests[0].status).toBe('pending')
  })
})

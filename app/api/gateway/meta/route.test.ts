import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toFunctionSelector } from 'viem'
import { fakeSupabase } from '@/lib/gateway/__audit__/fakeSupabase'

// O-2 / HO-2 / R-1 closeout: /api/gateway/meta must never advertise the env rig for an unknown pool
// while the registry is populated, must derive `live`, must tag `source`, and must return the
// INSTANCE's quote asset (not a global env). C-6: feature-detects depositWithMin/withdrawWithMin.

const state = vi.hoisted(() => ({
  supabase: null as unknown,
  cfg: null as unknown,
  readContract: (async (_a: unknown): Promise<unknown> => { throw new Error('rpc') }),
  getCode: (async (_a: unknown): Promise<string> => '0x'),
}))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => state.supabase }))
vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => state.cfg,
  gatewayPublicClient: () => ({ readContract: (a: unknown) => state.readContract(a), getCode: (a: unknown) => state.getCode(a) }),
}))

const ENV_PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11'
const REG_PM = '0x00000000000000000000000000000000000000aa'
const POOL_ID = '0x' + 'ab'.repeat(32)
const ENV_POOL = '0x' + 'ee'.repeat(32)
const QUOTE = '0x' + '22'.repeat(20)
const cfg = { chainId: 46630, rpcUrl: 'http://rpc.test', positionManager: ENV_PM, staging: null, poolAddress: ENV_POOL }
const registryRow = { pool_address: POOL_ID, chain_id: 46630, position_manager: REG_PM, staging: '0x' + '11'.repeat(20), quote_asset: QUOTE, status: 'active', pair_label: 'PONS / USDG' }

function req(url: string, ip = '203.0.113.1') {
  const r = new Request(url, { headers: { 'x-forwarded-for': ip } })
  ;(r as unknown as { nextUrl: URL }).nextUrl = new URL(url)
  return r as never
}
const SELS = toFunctionSelector('depositWithMin(uint256,uint256)').slice(2) + 'ff' + toFunctionSelector('withdrawWithMin(uint256,uint256,uint256)').slice(2)

beforeEach(() => {
  state.cfg = cfg
  state.readContract = async (a: unknown) => {
    const { functionName } = a as { functionName: string }
    if (functionName === 'quoteAsset') return QUOTE
    throw new Error('rpc') // poolKey etc. unreadable ⇒ fee/range fields null (never a false claim)
  }
  state.getCode = async () => '0x6080' + SELS + '00'
})

describe('GET /api/gateway/meta — strict resolution', () => {
  it('registry populated + unknown slug → 404 pool_not_live (no env rig, no live:true)', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [registryRow] } }).client
    const { GET } = await import('./route')
    const res = await GET(req('https://mw.test/api/gateway/meta?pool=not-a-registered-pool'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('pool_not_live')
  })
  it('registry hit → source registry, live true, the INSTANCE quote asset, supportsMin detected', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [registryRow] } }).client
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID.toUpperCase()}`))
    expect(res.status).toBe(200)
    const { meta } = await res.json()
    expect(meta.positionManager).toBe(REG_PM)
    expect(meta.poolAddress).toBe(POOL_ID)
    expect(meta.source).toBe('registry')
    expect(meta.live).toBe(true)
    expect(meta.usdg).toBe(QUOTE)
    expect(meta.pairLabel).toBe('PONS / USDG')
    expect(meta.supportsMin).toBe(true)
    expect(meta.feePips).toBeNull()
  })
  it('registry empty + the env pool → env rig tagged env-fallback, live FALSE', async () => {
    state.supabase = fakeSupabase().client
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${ENV_POOL}`))
    expect(res.status).toBe(200)
    const { meta } = await res.json()
    expect(meta.positionManager).toBe(ENV_PM)
    expect(meta.source).toBe('env-fallback')
    expect(meta.live).toBe(false)
    expect(meta.usdg).toBe(QUOTE) // from the contract's own quoteAsset() when no registry row
  })
  it('registry empty + a different pool → 404 (no silent re-route to the rig)', async () => {
    state.supabase = fakeSupabase().client
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`))
    expect(res.status).toBe(404)
  })
  it('supportsMin is false on a legacy PM without the *WithMin selectors, null when bytecode is unreadable', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [registryRow] } }).client
    const { GET } = await import('./route')
    state.getCode = async () => '0x6080604052'
    expect((await (await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`))).json()).meta.supportsMin).toBe(false)
    state.getCode = async () => { throw new Error('rpc') }
    expect((await (await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`))).json()).meta.supportsMin).toBeNull()
  })
  it('D-4: staging.adapter() exposes depositCap() → adapterKind idle, cap surfaced', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [registryRow] } }).client
    const IDLE_ADAPTER = '0x' + '77'.repeat(20)
    state.readContract = async (a: unknown) => {
      const { address, functionName } = a as { address: string; functionName: string }
      if (functionName === 'quoteAsset') return QUOTE
      if (functionName === 'adapter') return IDLE_ADAPTER
      if (functionName === 'depositCap' && address === IDLE_ADAPTER) return 5_000_000n
      throw new Error('rpc')
    }
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`))
    const { meta } = await res.json()
    expect(meta.adapterKind).toBe('idle')
    expect(meta.idleDepositCapAtomic).toBe('5000000')
  })
  it("D-4 audit fix (round-4): depositCap() fails AND perBlockWithdrawCap() answers (real adapter's own shape, positively confirmed) → adapterKind real", async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [registryRow] } }).client
    const REAL_ADAPTER = '0x' + '88'.repeat(20)
    state.readContract = async (a: unknown) => {
      const { address, functionName } = a as { address: string; functionName: string }
      if (functionName === 'quoteAsset') return QUOTE
      if (functionName === 'adapter') return REAL_ADAPTER
      if (functionName === 'depositCap') throw new Error('execution reverted (unknown selector)')
      if (functionName === 'perBlockWithdrawCap' && address === REAL_ADAPTER) return 10_000_000n
      throw new Error('rpc')
    }
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`))
    const { meta } = await res.json()
    expect(meta.adapterKind).toBe('real')
    expect(meta.idleDepositCapAtomic).toBeNull()
  })
  it("D-4 audit fix (round-4): depositCap() fails for a TRANSIENT reason (RPC timeout, not an ABI mismatch) and perBlockWithdrawCap() ALSO fails → adapterKind unknown, never a guessed 'real' (was the bug: used to default to 'real' here)", async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [registryRow] } }).client
    const SOME_ADAPTER = '0x' + '99'.repeat(20)
    state.readContract = async (a: unknown) => {
      const { functionName } = a as { functionName: string }
      if (functionName === 'quoteAsset') return QUOTE
      if (functionName === 'adapter') return SOME_ADAPTER
      if (functionName === 'depositCap') throw new Error('HttpRequestError: timeout of 10000ms exceeded')
      if (functionName === 'perBlockWithdrawCap') throw new Error('HttpRequestError: timeout of 10000ms exceeded')
      throw new Error('rpc')
    }
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`))
    const { meta } = await res.json()
    expect(meta.adapterKind).toBe('unknown')
    expect(meta.idleDepositCapAtomic).toBeNull()
  })
  it('D-4: staging.adapter() itself unreadable → adapterKind unknown (never a guessed claim)', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [registryRow] } }).client
    // default beforeEach readContract already throws for everything but quoteAsset
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`))
    const { meta } = await res.json()
    expect(meta.adapterKind).toBe('unknown')
  })
  it('registry quote_asset ≠ contract quoteAsset() → 409, no deposit target advertised', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [{ ...registryRow, quote_asset: '0x' + '99'.repeat(20) }] } }).client
    const { GET } = await import('./route')
    const res = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('instance_quote_mismatch')
  })
  // V1-09 fix (independent Codex audit, 2026-09-09): this route runs several RPC reads per call and had
  // no rate limit at all — createHandler's declarative option fails open without Upstash. Now has the
  // same in-memory per-IP floor as discover/sparklines (O-8).
  it('V1-09 fix: per-IP floor returns a 429-shaped JSON without Upstash', async () => {
    state.supabase = fakeSupabase({ tables: { gateway_instances: [registryRow] } }).client
    const { GET } = await import('./route')
    let saw429 = false
    for (let i = 0; i < 60; i++) {
      const r = await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`, '198.51.100.7'))
      if (r.status === 429) { saw429 = true; expect((await r.json()).code).toBe('RATE_LIMITED'); break }
    }
    expect(saw429).toBe(true)
    expect((await GET(req(`https://mw.test/api/gateway/meta?pool=${POOL_ID}`, '198.51.100.8'))).status).toBe(200)
  })
})

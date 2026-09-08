// POST /api/gateway/curate — curator auth (audit closeout O-3 / R-2 / HO-7). Real EIP-191 signatures,
// mocked registry + chain + supabase. Locks: allowlist fail-closed, action + payload binding, bearer
// path can neither register nor deactivate, register goes through the trust-root-verified registry.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { buildGatewayCurateMessage, type CurateAction } from '@/lib/gateway/curateAuth'

const registerMock = vi.fn()
const deactivateMock = vi.fn()
vi.mock('@/lib/gateway/registry', () => ({
  registerInstance: (...a: unknown[]) => registerMock(...a),
  deactivateInstance: (...a: unknown[]) => deactivateMock(...a),
  registryTrustConfigFromEnv: () => ({ factory: '0x' + 'fa'.repeat(20), pmCodeHashes: [], expectedQuoteAsset: '0x' + '11'.repeat(20) }),
}))
vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => ({ chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: null, staging: null, poolAddress: null }),
  gatewayPublicClient: () => ({ readContract: async () => { throw new Error('unused') } }),
}))

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = { gateway_pool_requests: [] }
vi.mock('@/lib/web2/supabase', () => ({
  getServiceClient: () => ({
    from(table: string) {
      const rows = (tables[table] ??= [])
      const filters: [string, unknown][] = []
      let op: 'select' | 'update' = 'select'
      let patch: Row | undefined
      const hit = () => rows.filter((r) => filters.every(([c, v]) => String(r[c]) === String(v)))
      const b = {
        select: () => b, order: () => b, limit: () => b,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
        update: (p: Row) => { op = 'update'; patch = p; return b },
        maybeSingle: async () => ({ data: hit()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => { if (op === 'update') for (const r of hit()) Object.assign(r, patch); return Promise.resolve({ data: hit(), error: null }).then(res) },
      }
      return b
    },
  }),
}))

import { POST } from '@/app/api/gateway/curate/route'

const curator = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const stranger = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba')
const POOL = '0x' + 'ab'.repeat(32)
const PM = '0x' + 'cc'.repeat(20)
const STG = '0x' + 'dd'.repeat(20)

async function signedBody(account: typeof curator, over: {
  action: CurateAction; requestId?: string | null; poolAddress?: string | null; chainId?: number | null
  instance?: { positionManager: string; staging: string } | null; reason?: string; tamper?: (b: Row) => void
}) {
  const issuedAt = Date.now()
  const authMessage = buildGatewayCurateMessage({
    address: account.address, issuedAt, curateAction: over.action, requestId: over.requestId ?? null,
    poolAddress: over.poolAddress ?? null, chainId: over.chainId ?? null,
    positionManager: over.instance?.positionManager ?? null, staging: over.instance?.staging ?? null,
  })
  const authSignature = await account.signMessage({ message: authMessage })
  const body: Row = {
    address: account.address, authMessage, authSignature, issuedAt, action: over.action,
    requestId: over.requestId ?? undefined, poolAddress: over.poolAddress ?? undefined, chainId: over.chainId ?? undefined,
    instance: over.instance ?? undefined, reason: over.reason,
  }
  over.tamper?.(body)
  return body
}
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost/api/gateway/curate', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) as never)

beforeEach(() => {
  registerMock.mockReset().mockResolvedValue({ ok: true, verification: 'factory' })
  deactivateMock.mockReset().mockResolvedValue({ ok: true })
  tables.gateway_pool_requests = [{ id: 'req-1', pool_address: POOL, chain_id: 46630, pair_label: 'MEME/USDG', status: 'pending' }]
  process.env.LP_GATEWAY_CURATORS = curator.address
  process.env.LP_GATEWAY_CURATOR_SECRET = 'server-secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
  delete process.env.UPSTASH_REDIS_REST_URL
})

describe('curator (signed-message) path', () => {
  it('allowlisted curator approves + registers: registry called with the verified client + env trust, actor = signer', async () => {
    const res = await post(await signedBody(curator, { action: 'approve', requestId: 'req-1', poolAddress: POOL, chainId: 46630, instance: { positionManager: PM, staging: STG } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, action: 'approved', registered: true, verification: 'factory' })
    expect(registerMock).toHaveBeenCalledTimes(1)
    const [, row, verify] = registerMock.mock.calls[0] as [unknown, Row, Row]
    expect(row).toMatchObject({ poolAddress: POOL, chainId: 46630, positionManager: PM, staging: STG, createdBy: curator.address.toLowerCase() })
    expect(row.quoteAsset).toBeUndefined() // never taken from the request
    expect(verify).toHaveProperty('client')
    expect(verify).toHaveProperty('trust')
    expect(tables.gateway_pool_requests[0]).toMatchObject({ status: 'approved', reviewed_by: curator.address.toLowerCase() })
  })

  it('a non-allowlisted wallet with a VALID signature is refused (403) and nothing is written', async () => {
    const res = await post(await signedBody(stranger, { action: 'approve', requestId: 'req-1', poolAddress: POOL, chainId: 46630 }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('not_a_curator')
    expect(tables.gateway_pool_requests[0].status).toBe('pending')
  })

  it('no allowlist configured ⇒ 503 for everyone (fail closed)', async () => {
    delete process.env.LP_GATEWAY_CURATORS
    const res = await post(await signedBody(curator, { action: 'reject', requestId: 'req-1', poolAddress: POOL, chainId: 46630 }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('curators_not_configured')
  })

  it('payload binding: a signature for "reject" cannot be replayed as "approve"', async () => {
    const res = await post(await signedBody(curator, { action: 'reject', requestId: 'req-1', poolAddress: POOL, chainId: 46630, tamper: (b) => { b.action = 'approve' } }))
    expect(res.status).toBe(401)
    expect(tables.gateway_pool_requests[0].status).toBe('pending')
  })

  it('payload binding: the signed candidate PM cannot be swapped in the body', async () => {
    const res = await post(await signedBody(curator, {
      action: 'approve', requestId: 'req-1', poolAddress: POOL, chainId: 46630, instance: { positionManager: PM, staging: STG },
      tamper: (b) => { b.instance = { positionManager: '0x' + 'ee'.repeat(20), staging: STG } },
    }))
    expect(res.status).toBe(401)
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('payload binding: the signed pool must be the request’s pool', async () => {
    const res = await post(await signedBody(curator, { action: 'approve', requestId: 'req-1', poolAddress: '0x' + 'ff'.repeat(32), chainId: 46630 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('pool_mismatch')
  })

  it('a wrong-action signature (another mintware-* route) is refused by the factory action binding', async () => {
    const issuedAt = Date.now()
    const authMessage = JSON.stringify({ action: 'mintware-gateway-deposit', address: curator.address.toLowerCase(), issuedAt }, null, 2)
    const authSignature = await curator.signMessage({ message: authMessage })
    const res = await post({ address: curator.address, authMessage, authSignature, issuedAt, action: 'reject', requestId: 'req-1' })
    expect(res.status).toBe(401)
  })

  it('registry refusal surfaces as 400 (verify) / 409 (active row) and the request stays pending', async () => {
    registerMock.mockResolvedValueOnce({ ok: false, error: 'onchain_verify_failed:codehash_not_allowlisted' })
    let res = await post(await signedBody(curator, { action: 'approve', requestId: 'req-1', poolAddress: POOL, chainId: 46630, instance: { positionManager: PM, staging: STG } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'onchain_verify_failed', detail: 'onchain_verify_failed:codehash_not_allowlisted' })
    registerMock.mockResolvedValueOnce({ ok: false, error: 'active_instance_exists' })
    res = await post(await signedBody(curator, { action: 'approve', requestId: 'req-1', poolAddress: POOL, chainId: 46630, instance: { positionManager: PM, staging: STG } }))
    expect(res.status).toBe(409)
    expect(tables.gateway_pool_requests[0].status).toBe('pending')
  })

  it('deactivate: curator-signed, reason required, routed to the logged registry step', async () => {
    const res = await post(await signedBody(curator, { action: 'deactivate', poolAddress: POOL, chainId: 46630, reason: 'migrating rig' }))
    expect(res.status).toBe(200)
    expect(deactivateMock).toHaveBeenCalledWith(expect.anything(), { poolAddress: POOL, chainId: 46630, by: curator.address.toLowerCase(), reason: 'migrating rig' })
  })
})

describe('server (bearer) path', () => {
  it('approves/rejects with the shared secret but may NOT register or deactivate', async () => {
    let res = await post({ action: 'reject', requestId: 'req-1' }, { authorization: 'Bearer server-secret' })
    expect(res.status).toBe(200)
    expect(tables.gateway_pool_requests[0]).toMatchObject({ status: 'rejected', reviewed_by: 'server:bearer' })
    tables.gateway_pool_requests[0].status = 'pending'
    res = await post({ action: 'approve', requestId: 'req-1', instance: { positionManager: PM, staging: STG } }, { authorization: 'Bearer server-secret' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('register_requires_curator_signature')
    expect(registerMock).not.toHaveBeenCalled()
    res = await post({ action: 'deactivate', poolAddress: POOL, chainId: 46630, reason: 'x' }, { authorization: 'Bearer server-secret' })
    expect(res.status).toBe(403)
    expect(deactivateMock).not.toHaveBeenCalled()
  })
  it('wrong bearer ⇒ 401; unset secret ⇒ 503 even outside production (no dev pass-through)', async () => {
    expect((await post({ action: 'reject', requestId: 'req-1' }, { authorization: 'Bearer nope' })).status).toBe(401)
    delete process.env.LP_GATEWAY_CURATOR_SECRET
    const res = await post({ action: 'reject', requestId: 'req-1' }, { authorization: 'Bearer anything' })
    expect([500, 503]).toContain(res.status)
    expect(tables.gateway_pool_requests[0].status).toBe('pending')
  })
})

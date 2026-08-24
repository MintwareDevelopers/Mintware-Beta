import { describe, it, expect } from 'vitest'
import { httpEdgeAuthorizer, httpSettler, deferredSettler, httpSpendableSource } from './edgeHttp'
import type { PaymentPayload, PaymentRequirements } from './types'

const PAYER = '0xAbCdEf0000000000000000000000000000000001'

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return ((url: string, init?: RequestInit) => Promise.resolve(handler(url, init))) as unknown as typeof fetch
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('httpEdgeAuthorizer', () => {
  it('maps an approved edge response + lowercases the payer + uses the nonce as hold_id', async () => {
    let seen: any
    const edge = httpEdgeAuthorizer({
      url: 'http://edge',
      secret: 's',
      fetchImpl: mockFetch(async (_u, init) => {
        seen = JSON.parse(String(init!.body))
        return json({ approved: true, hold_id: 'h1', hold_usdc: '1000000' })
      }),
    })
    const out = await edge.authorize({ payer: PAYER, amountAtomic: '1000000', ref: 'nonce-x' })
    expect(out).toEqual({ approved: true, holdId: 'h1', holdAtomic: '1000000', reason: undefined })
    expect(seen).toEqual({ user: PAYER.toLowerCase(), amount_usdc: '1000000', hold_id: 'nonce-x' })
  })

  it('maps a decline reason', async () => {
    const edge = httpEdgeAuthorizer({ url: 'http://edge', secret: 's', fetchImpl: mockFetch(async () => json({ approved: false, decline_reason: 'insufficient_equity' })) })
    expect(await edge.authorize({ payer: PAYER, amountAtomic: '1', ref: 'n' })).toMatchObject({ approved: false, reason: 'insufficient_equity' })
  })

  it('maps non-2xx to edge_<status> and a thrown fetch to edge_unreachable', async () => {
    const e500 = httpEdgeAuthorizer({ url: 'http://edge', secret: 's', fetchImpl: mockFetch(async () => json({}, 500)) })
    expect(await e500.authorize({ payer: PAYER, amountAtomic: '1', ref: 'n' })).toMatchObject({ approved: false, reason: 'edge_500' })
    const eThrow = httpEdgeAuthorizer({ url: 'http://edge', secret: 's', fetchImpl: (() => Promise.reject(new Error('down'))) as unknown as typeof fetch })
    expect(await eThrow.authorize({ payer: PAYER, amountAtomic: '1', ref: 'n' })).toMatchObject({ approved: false, reason: 'edge_unreachable' })
  })
})

describe('settlers', () => {
  const HOLD = `0x${'01'.repeat(32)}`
  const reqs = { network: 'base', payTo: '0x2222222222222222222222222222222222222222', maxAmountRequired: '100000000' } as unknown as PaymentRequirements
  // x402 payload carries an EIP-3009 authorization: `from` = payer, `value` = atomic USDC charge.
  const payload = { payload: { authorization: { from: PAYER, value: '100000000' } } } as unknown as PaymentPayload
  const permit = {
    user: PAYER.toLowerCase(),
    max_daily_spend_usdc: '1000000000',
    nonce: '1',
    deadline: '9999999999',
    signature: '0xaa',
  }

  it('httpSettler POSTs the real SettleParams-shaped body (hold_id/user/assets/receiver/permit)', async () => {
    let seenBody: any
    const ok = httpSettler({
      url: 'http://relay',
      fetchImpl: mockFetch(async (_u, init) => {
        seenBody = JSON.parse(String(init!.body))
        return json({ success: true, tx_hash: '0xabc', status: 'submitted' })
      }),
    })
    expect(await ok.settle({ holdId: HOLD, payload, reqs, permit })).toMatchObject({ success: true, txHash: '0xabc' })
    expect(seenBody).toEqual({
      hold_id: HOLD,
      user: PAYER.toLowerCase(),
      assets: '100000000',
      receiver: reqs.payTo,
      permit,
    })
    expect(seenBody.edge).toBeUndefined() // low-value: no edge auth
  })

  it('httpSettler includes the edge auth for high-value settles', async () => {
    let seenBody: any
    const edge = { hold_id: HOLD, user: PAYER.toLowerCase(), amount_usdc: '300000000', nonce: '1', expiry: '9999999999', signature: '0xbb' }
    const ok = httpSettler({ url: 'http://relay', fetchImpl: mockFetch(async (_u, init) => { seenBody = JSON.parse(String(init!.body)); return json({ success: true, tx_hash: '0xabc' }) }) })
    await ok.settle({ holdId: HOLD, payload, reqs, permit, edge })
    expect(seenBody.edge).toEqual(edge)
  })

  it('httpSettler fails closed when the Gateway permit is unavailable (never POSTs a fake body)', async () => {
    let called = false
    const s = httpSettler({ url: 'http://relay', fetchImpl: mockFetch(async () => { called = true; return json({ success: true }) }) })
    expect(await s.settle({ holdId: HOLD, payload, reqs })).toMatchObject({ success: false, errorReason: 'settlement_permit_unavailable' })
    expect(called).toBe(false)
  })

  it('httpSettler fails closed when the hold id is missing', async () => {
    const s = httpSettler({ url: 'http://relay', fetchImpl: mockFetch(async () => json({ success: true })) })
    expect(await s.settle({ payload, reqs, permit })).toMatchObject({ success: false, errorReason: 'settlement_hold_missing' })
  })

  it('httpSettler maps a relayer failure + unreachable', async () => {
    const bad = httpSettler({ url: 'http://relay', fetchImpl: mockFetch(async () => json({ success: false, error: 'submit_error' }, 502)) })
    expect(await bad.settle({ holdId: HOLD, payload, reqs, permit })).toMatchObject({ success: false, errorReason: 'relayer_502' })
    const down = httpSettler({ url: 'http://relay', fetchImpl: (() => Promise.reject(new Error('x'))) as unknown as typeof fetch })
    expect(await down.settle({ holdId: HOLD, payload, reqs, permit })).toMatchObject({ success: false, errorReason: 'relayer_unreachable' })
  })

  it('deferredSettler never claims success', async () => {
    expect(await deferredSettler.settle({ payload, reqs })).toMatchObject({ success: false, errorReason: 'settlement_deferred_relayer_unconfigured' })
  })
})

describe('httpSpendableSource', () => {
  it('maps available_usdc to a bigint and lowercases the user in the path', async () => {
    let seenUrl = ''
    const src = httpSpendableSource({
      url: 'http://edge',
      secret: 's',
      fetchImpl: mockFetch(async (url) => {
        seenUrl = url
        return json({ user: PAYER.toLowerCase(), available_usdc: '900000000' })
      }),
    })
    expect(await src.headroomAtomic(PAYER)).toBe(900_000_000n)
    expect(seenUrl).toBe(`http://edge/available/${PAYER.toLowerCase()}`)
  })

  it('returns null (→ spendable falls back to parked) on non-ok or thrown fetch', async () => {
    const s500 = httpSpendableSource({ url: 'http://edge', secret: 's', fetchImpl: mockFetch(async () => json({}, 500)) })
    expect(await s500.headroomAtomic(PAYER)).toBeNull()
    const sThrow = httpSpendableSource({ url: 'http://edge', secret: 's', fetchImpl: (() => Promise.reject(new Error('down'))) as unknown as typeof fetch })
    expect(await sThrow.headroomAtomic(PAYER)).toBeNull()
  })
})

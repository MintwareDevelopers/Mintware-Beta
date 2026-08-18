import { describe, it, expect } from 'vitest'
import { httpEdgeAuthorizer, httpSettler, deferredSettler } from './edgeHttp'
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
  const reqs = { network: 'base', payTo: '0x2' } as unknown as PaymentRequirements
  const payload = {} as PaymentPayload

  it('httpSettler maps success + failure', async () => {
    const ok = httpSettler({ url: 'http://relay', fetchImpl: mockFetch(async () => json({ success: true, tx_hash: '0xabc' })) })
    expect(await ok.settle({ holdId: 'h', payload, reqs })).toMatchObject({ success: true, txHash: '0xabc' })
    const down = httpSettler({ url: 'http://relay', fetchImpl: (() => Promise.reject(new Error('x'))) as unknown as typeof fetch })
    expect(await down.settle({ holdId: 'h', payload, reqs })).toMatchObject({ success: false, errorReason: 'relayer_unreachable' })
  })

  it('deferredSettler never claims success', async () => {
    expect(await deferredSettler.settle({ payload, reqs })).toMatchObject({ success: false, errorReason: 'settlement_deferred_relayer_unconfigured' })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const require402Spy = vi.fn()
vi.mock('@/lib/x402/require402', () => ({
  require402: (...args: unknown[]) => require402Spy(...args),
  readPaymentSignature: () => null,
}))
vi.mock('@/lib/x402/config', () => ({
  getFacilitator: () => ({ settle: vi.fn(async () => ({ success: true })) }),
  defaultPayTo: () => '0x7fD88B026B65B9f54FFE694bB422bBCC504D7E06',
  supportedNetworks: () => ['base-sepolia'],
  USDC_BY_NETWORK: { 'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
}))
vi.mock('@/lib/attribution/serverScore', () => ({
  getServerLegacyScore: vi.fn(async (a: string) => ({ score: 100, tier: 'bronze', address: a })),
}))

import { POST } from '@/app/api/x402/scores/route'

const addr = (c: string) => '0x' + c.repeat(40)
const call = (body: unknown) =>
  POST(new Request('http://localhost/api/x402/scores', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }))

const PAID = { paid: true, payer: '0xpayer', holdId: 'h1', requirements: {}, payload: {} }

describe('POST /api/x402/scores — batch score seller', () => {
  beforeEach(() => require402Spy.mockReset())

  it('400s when addresses[] is missing/empty', async () => {
    expect((await call({})).status).toBe(400)
    expect((await call({ addresses: [] })).status).toBe(400)
  })

  it('400s over the batch cap (50)', async () => {
    const many = Array.from({ length: 51 }, (_, i) => '0x' + i.toString(16).padStart(40, '0'))
    expect((await call({ addresses: many })).status).toBe(400)
  })

  it('400s on a non-EVM address in the set', async () => {
    expect((await call({ addresses: [addr('1'), 'not-an-address'] })).status).toBe(400)
  })

  it('prices count × base and returns every score when paid', async () => {
    require402Spy.mockResolvedValue(PAID)
    const r = await call({ addresses: [addr('1'), addr('2')] })
    const j = await r.json()
    expect(j.paid).toBe(true)
    expect(j.count).toBe(2)
    expect(j.priceAtomic).toBe('20000') // 2 × 10000
    expect(j.scores).toHaveLength(2)
    // the 402 challenge was priced for the whole (de-duped) set
    expect(require402Spy).toHaveBeenCalledWith(null, expect.objectContaining({ priceAtomic: '20000' }), expect.anything())
  })

  it('de-dupes — the same address repeated is priced + served once', async () => {
    require402Spy.mockResolvedValue({ ...PAID })
    const a = addr('a')
    const r = await call({ addresses: [a, a, a] })
    const j = await r.json()
    expect(j.count).toBe(1)
    expect(j.priceAtomic).toBe('10000')
    expect(j.scores).toHaveLength(1)
  })

  it('returns the 402 challenge verbatim when unpaid', async () => {
    require402Spy.mockResolvedValue({ paid: false, status: 402, headers: { 'PAYMENT-REQUIRED': 'x' }, body: { x402Version: 2 } })
    const r = await call({ addresses: [addr('1')] })
    expect(r.status).toBe(402)
    expect(r.headers.get('PAYMENT-REQUIRED')).toBe('x')
  })
})

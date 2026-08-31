import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  bridgeApiConfigured,
  centsToAtomicUsdc,
  issueBridgeCard,
  normalizeBridgeEvent,
  verifyBridgeWebhook,
} from './bridgeClient'

const ENV = ['BRIDGE_API_KEY', 'BRIDGE_API_URL', 'BRIDGE_WEBHOOK_SECRET'] as const
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]!
  }
  vi.restoreAllMocks()
})

describe('bridgeApiConfigured', () => {
  it('is false without an API key', () => {
    delete process.env.BRIDGE_API_KEY
    expect(bridgeApiConfigured()).toBe(false)
    process.env.BRIDGE_API_KEY = 'k'
    expect(bridgeApiConfigured()).toBe(true)
  })
})

describe('issueBridgeCard', () => {
  it('posts a standard crypto_account linked to the funding wallet and returns the card id', async () => {
    process.env.BRIDGE_API_KEY = 'sk_test'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'card_abc', last_four: '4242', status: 'active' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const card = await issueBridgeCard({
      memberWallet: '0xmember',
      fundingWallet: '0xbuffer',
      chain: 'base',
      idempotencyKey: 'idem-1',
    })
    expect(card).toEqual({ bridgeCardId: 'card_abc', lastFour: '4242', status: 'active' })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.crypto_account).toEqual({ type: 'standard', chain: 'base', currency: 'usdc', address: '0xbuffer' })
    expect(init.headers['Idempotency-Key']).toBe('idem-1')
    expect(init.headers['Api-Key']).toBe('sk_test')
  })

  it('throws on a non-2xx (so onboarding treats issuance as not-done and retries)', async () => {
    process.env.BRIDGE_API_KEY = 'sk_test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({}) }))
    await expect(
      issueBridgeCard({ memberWallet: '0x', fundingWallet: '0x', chain: 'base', idempotencyKey: 'i' }),
    ).rejects.toThrow('bridge_issue_failed_422')
  })

  it('throws when unconfigured', async () => {
    delete process.env.BRIDGE_API_KEY
    await expect(
      issueBridgeCard({ memberWallet: '0x', fundingWallet: '0x', chain: 'base', idempotencyKey: 'i' }),
    ).rejects.toThrow('bridge_api_unconfigured')
  })
})

describe('verifyBridgeWebhook', () => {
  const SECRET = 'whsec_test'
  const T = 1_700_000_000
  const sign = (body: string, t: number = T) => {
    const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')
    return { 'stripe-signature': `t=${t},v1=${v1}` }
  }

  it('fails closed (unconfigured) when the secret is unset', () => {
    delete process.env.BRIDGE_WEBHOOK_SECRET
    expect(verifyBridgeWebhook('{}', {})).toEqual({ ok: false, reason: 'unconfigured' })
  })

  it('accepts a correctly-signed, fresh event', () => {
    process.env.BRIDGE_WEBHOOK_SECRET = SECRET
    const body = JSON.stringify({ id: 'evt_1', type: 'issuing_transaction.created' })
    const r = verifyBridgeWebhook(body, sign(body), { nowSecs: T })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.event.type).toBe('issuing_transaction.created')
  })

  it('rejects a STALE (replayed) event outside the tolerance window', () => {
    process.env.BRIDGE_WEBHOOK_SECRET = SECRET
    const body = JSON.stringify({ id: 'evt_1', type: 'issuing_transaction.created' })
    // same valid signature, but "now" is 400s past the signed timestamp (> 300s default)
    const r = verifyBridgeWebhook(body, sign(body), { nowSecs: T + 400 })
    expect(r).toEqual({ ok: false, reason: 'stale' })
  })

  it('rejects a tampered body / wrong signature (before the freshness check)', () => {
    process.env.BRIDGE_WEBHOOK_SECRET = SECRET
    const headers = sign(JSON.stringify({ type: 'a' }))
    const r = verifyBridgeWebhook(JSON.stringify({ type: 'tampered' }), headers, { nowSecs: T })
    expect(r).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a missing signature header', () => {
    process.env.BRIDGE_WEBHOOK_SECRET = SECRET
    expect(verifyBridgeWebhook('{}', {})).toEqual({ ok: false, reason: 'bad_signature' })
  })
})

describe('normalizeBridgeEvent', () => {
  const evt = (type: string, object: Record<string, unknown>, id = 'evt') => ({ id, type, data: { object } })

  it('maps a capture to spend with atomic amount + card id', () => {
    const r = normalizeBridgeEvent(evt('issuing_transaction.created', { type: 'capture', amount: -1234, card: 'card_x' }))
    expect(r).toEqual({ kind: 'spend', providerCardId: 'card_x', amountAtomic: 12_340_000n, eventId: 'evt' })
  })

  it('maps a standard (positive) refund to refund', () => {
    const r = normalizeBridgeEvent(evt('issuing_transaction.created', { type: 'refund', amount: 500, card: 'card_x' }))
    expect(r.kind).toBe('refund')
  })

  it('maps a refund REVERSAL (type refund, negative amount) to spend — it is a debit', () => {
    const r = normalizeBridgeEvent(evt('issuing_transaction.created', { type: 'refund', amount: -500, card: 'card_x' }))
    expect(r.kind).toBe('spend')
  })

  it('falls back on sign when type is absent (negative = spend)', () => {
    expect(normalizeBridgeEvent(evt('issuing_transaction.created', { amount: -99, card: 'c' })).kind).toBe('spend')
    expect(normalizeBridgeEvent(evt('issuing_transaction.created', { amount: 99, card: 'c' })).kind).toBe('refund')
  })

  it('ignores authorizations and unrelated events', () => {
    expect(normalizeBridgeEvent(evt('issuing_authorization.created', { card: 'c' })).kind).toBe('ignore')
    expect(normalizeBridgeEvent(evt('ping', {})).kind).toBe('ignore')
  })

  it('centsToAtomicUsdc converts 2dp cents → 6dp atomic (abs)', () => {
    expect(centsToAtomicUsdc(100)).toBe(1_000_000n) // $1.00
    expect(centsToAtomicUsdc(-250)).toBe(2_500_000n) // $2.50 debit
  })
})

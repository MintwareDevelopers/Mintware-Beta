import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/yield/rateFeed', () => ({
  fetchVenueRates: vi.fn(),
}))

import { POST } from '@/app/api/(rewards)/cron/yield-reweight/route'
import { fetchVenueRates } from '@/lib/yield/rateFeed'

const auth = (secret = 'test-secret') =>
  new Request('http://localhost/api/cron/yield-reweight', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  })

const liveRates = () => ({
  ok: true as const,
  source: 'DefiLlama' as const,
  asOf: new Date().toISOString(),
  ratesByKey: { 'aave-v3-usdc': 4.2, 'morpho-usdc': 6.1, 'fluid-usdc': 5.0, 'compound-v3-usdc': 3.1 },
})

const KEEPER_ENV = [
  'YIELD_KEEPER_ENABLED',
  'YIELD_KEEPER_PRIVATE_KEY',
  'YIELD_MULTIVENUE_ADAPTER',
  'YIELD_VENUES_JSON',
  'YIELD_MAX_VENUE_BPS',
  'YIELD_IDLE_BUFFER_BPS',
]

describe('POST /api/cron/yield-reweight', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    for (const k of KEEPER_ENV) delete process.env[k]
  })
  afterEach(() => {
    for (const k of KEEPER_ENV) delete process.env[k]
  })

  it('rejects unauthorized requests', async () => {
    const req = new Request('http://localhost/api/cron/yield-reweight', { method: 'POST' })
    const res = await POST(req as never)
    expect(res.status).toBe(401)
  })

  it('dry-run: returns a valid plan and NEVER submits when nothing is configured', async () => {
    vi.mocked(fetchVenueRates).mockResolvedValue(liveRates())

    const res = await POST(auth() as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('dry-run')
    expect(body.submitted).toBe(false)
    expect(body.wouldSubmit).toBe(false)
    expect(body.usingPlaceholderAdapters).toBe(true)
    // valid setVenues args: equal-length arrays, Σ ≤ 10000, best-rate-first (morpho 6.1% leads).
    expect(body.plan.adapters.length).toBe(body.plan.weightsBps.length)
    expect(body.plan.adapters.length).toBeGreaterThan(0)
    expect(body.plan.totalDeployedBps).toBeLessThanOrEqual(10_000)
    expect(body.reweightWarranted).toBe(true) // first allocation off empty on-chain state
    expect(body.submitReason).toMatch(/deploy-gated/)
    expect(body.submitReason).toMatch(/YIELD_KEEPER_ENABLED/)
  })

  it('fails soft to an empty plan (capital stays put) when live rates are unavailable', async () => {
    vi.mocked(fetchVenueRates).mockResolvedValue({
      ok: false, source: 'DefiLlama', asOf: new Date().toISOString(), ratesByKey: {}, error: 'DefiLlama 500',
    })

    const res = await POST(auth() as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.ratesAvailable).toBe(false)
    expect(body.plan.adapters).toEqual([])
    expect(body.plan.weightsBps).toEqual([])
    expect(body.reweightWarranted).toBe(false) // nothing to do
    expect(body.submitted).toBe(false)
  })

  it('maps live rates onto the wired child adapters (best-rate-first) when configured', async () => {
    vi.mocked(fetchVenueRates).mockResolvedValue(liveRates())
    process.env.YIELD_MAX_VENUE_BPS = '4000'
    const a1 = '0x1111111111111111111111111111111111111111'
    const a2 = '0x2222222222222222222222222222222222222222'
    const a3 = '0x3333333333333333333333333333333333333333'
    process.env.YIELD_VENUES_JSON = JSON.stringify({
      'aave-v3-usdc': a1, 'morpho-usdc': a2, 'fluid-usdc': a3,
    })

    const res = await POST(auth() as never)
    const body = await res.json()

    expect(body.usingPlaceholderAdapters).toBe(false)
    expect(body.adaptersWired).toBe(3)
    // morpho (6.1%) 40%, fluid (5.0%) 40%, aave (4.2%) 20% — best-rate-first, 40% cap.
    expect(body.plan.adapters).toEqual([a2, a3, a1])
    expect(body.plan.weightsBps).toEqual([4_000, 4_000, 2_000])
  })

  it('reports wouldSubmit=true only when every submit gate is wired — still submitted=false in this PR', async () => {
    vi.mocked(fetchVenueRates).mockResolvedValue(liveRates())
    process.env.YIELD_KEEPER_ENABLED = 'true'
    process.env.YIELD_KEEPER_PRIVATE_KEY = '0x' + 'a'.repeat(64)
    process.env.YIELD_MULTIVENUE_ADAPTER = '0x4444444444444444444444444444444444444444'
    process.env.YIELD_VENUES_JSON = JSON.stringify({
      'morpho-usdc': '0x2222222222222222222222222222222222222222',
    })

    const res = await POST(auth() as never)
    const body = await res.json()

    expect(body.keeper.enabled).toBe(true)
    expect(body.wouldSubmit).toBe(true)
    expect(body.submitted).toBe(false) // NEVER submits in this PR
    expect(body.submitReason).toMatch(/deploy-gated in this PR/)
  })

  it('ignores a malformed YIELD_VENUES_JSON (no garbage adapter address ever reaches a plan)', async () => {
    vi.mocked(fetchVenueRates).mockResolvedValue(liveRates())
    process.env.YIELD_VENUES_JSON = '{ not valid json'

    const res = await POST(auth() as never)
    const body = await res.json()

    expect(body.usingPlaceholderAdapters).toBe(true) // override discarded → falls back to placeholders
    expect(body.adaptersWired).toBe(0)
  })
})

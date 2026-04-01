import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rewards/universal/bridgeCron', () => ({
  bridgeUniversalEpochsToDistributor: vi.fn(),
}))

import { GET } from '@/app/api/(rewards)/cron/universal-distribution-bridge/route'
import { bridgeUniversalEpochsToDistributor } from '@/lib/rewards/universal/bridgeCron'

describe('GET /api/cron/universal-distribution-bridge', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('rejects unauthorized requests', async () => {
    const req = new Request('http://localhost/api/cron/universal-distribution-bridge')
    const res = await GET(req as never)
    expect(res.status).toBe(401)
  })

  it('returns bridge results for authorized requests', async () => {
    vi.mocked(bridgeUniversalEpochsToDistributor).mockResolvedValue({
      attempted: 2,
      bridged: 1,
      results: [{ epoch_id: 'epoch-1', distribution_id: 'dist-1', campaign_id: 'universal:8453:0xpool', published: true }],
    })

    const req = new Request('http://localhost/api/cron/universal-distribution-bridge?limit=10', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const res = await GET(req as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      attempted: 2,
      bridged: 1,
    })
    expect(vi.mocked(bridgeUniversalEpochsToDistributor)).toHaveBeenCalledWith(10)
  })
})

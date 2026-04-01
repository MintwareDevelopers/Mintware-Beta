import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rewards/universal/settler', () => ({
  settleUniversalEpochs: vi.fn(),
}))

import { GET } from '@/app/api/(rewards)/cron/universal-epoch-close/route'
import { settleUniversalEpochs } from '@/lib/rewards/universal/settler'

describe('GET /api/cron/universal-epoch-close', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('rejects unauthorized requests', async () => {
    const req = new Request('http://localhost/api/cron/universal-epoch-close')
    const res = await GET(req as never)

    expect(res.status).toBe(401)
  })

  it('returns settle results for authorized requests', async () => {
    vi.mocked(settleUniversalEpochs).mockResolvedValue({
      epochs_settled: 1,
      signals_settled: 3,
      results: [],
    })

    const req = new Request('http://localhost/api/cron/universal-epoch-close', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const res = await GET(req as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      epochs_settled: 1,
      signals_settled: 3,
    })
  })
})

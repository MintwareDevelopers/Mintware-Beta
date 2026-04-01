import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rewards/universal/indexer', () => ({
  syncTradeSignals: vi.fn(),
}))

vi.mock('@/lib/rewards/universal/settler', () => ({
  settleUniversalEpochs: vi.fn(),
}))

vi.mock('@/lib/rewards/universal/bridgeCron', () => ({
  bridgeUniversalEpochsToDistributor: vi.fn(),
}))

import { GET } from '@/app/api/(rewards)/cron/universal-pipeline/route'
import { syncTradeSignals } from '@/lib/rewards/universal/indexer'
import { settleUniversalEpochs } from '@/lib/rewards/universal/settler'
import { bridgeUniversalEpochsToDistributor } from '@/lib/rewards/universal/bridgeCron'

describe('GET /api/cron/universal-pipeline', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    process.env.UNIVERSAL_TRADE_SIGNAL_HOOK_ADDRESS = '0x1111000000000000000000000000000000000011'
    process.env.UNIVERSAL_TRADE_SIGNAL_CHAIN = 'base_sepolia'
    process.env.UNIVERSAL_DISTRIBUTION_BRIDGE_LIMIT = '10'
  })

  it('rejects unauthorized requests', async () => {
    const req = new Request('http://localhost/api/cron/universal-pipeline')
    const res = await GET(req as never)
    expect(res.status).toBe(401)
  })

  it('runs the universal chain in order for authorized requests', async () => {
    vi.mocked(syncTradeSignals).mockResolvedValue({
      chain_slug: 'base_sepolia',
      contract_address: '0x1111000000000000000000000000000000000011',
      from_block: 100n,
      to_block: 110n,
      scanned_logs: 2,
      upserted_rows: 2,
    })
    vi.mocked(settleUniversalEpochs).mockResolvedValue({
      epochs_settled: 1,
      signals_settled: 2,
      results: [],
    })
    vi.mocked(bridgeUniversalEpochsToDistributor).mockResolvedValue({
      attempted: 1,
      bridged: 1,
      results: [],
    })

    const req = new Request('http://localhost/api/cron/universal-pipeline', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const res = await GET(req as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      settle: { epochs_settled: 1, signals_settled: 2 },
      bridge: { attempted: 1, bridged: 1 },
    })
    expect(vi.mocked(syncTradeSignals)).toHaveBeenCalledWith({
      chainSlug: 'base_sepolia',
      contractAddress: '0x1111000000000000000000000000000000000011',
      initialWindow: undefined,
      confirmations: undefined,
    })
    expect(vi.mocked(settleUniversalEpochs)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(bridgeUniversalEpochsToDistributor)).toHaveBeenCalledWith(10)
  })
})

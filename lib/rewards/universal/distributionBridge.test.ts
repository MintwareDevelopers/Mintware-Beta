import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/web2/supabase', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/web3/onchainPublisher', () => ({
  publishDistribution: vi.fn(),
}))

import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { publishDistribution } from '@/lib/web3/onchainPublisher'
import { publishUniversalEpochToDistributor, universalCampaignId } from '@/lib/rewards/universal/distributionBridge'

describe('universal distribution bridge', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.UNIVERSAL_SETTLEMENT_TOKEN_SYMBOL = 'USDC'
    process.env.UNIVERSAL_SETTLEMENT_TOKEN_ADDRESS = '0x1111000000000000000000000000000000000011'
    process.env.UNIVERSAL_SETTLEMENT_TOKEN_DECIMALS = '6'
    process.env.UNIVERSAL_SETTLEMENT_REWARD_CHAIN = 'evm'
    process.env.UNIVERSAL_DISTRIBUTOR_ADDRESS = '0x2222000000000000000000000000000000000022'
  })

  it('derives deterministic synthetic campaign ids', () => {
    expect(universalCampaignId(8453, '0xPOOL')).toBe('universal:8453:0xpool')
  })

  it('bridges a settled epoch into campaigns, distributions, and payout rows', async () => {
    vi.mocked(publishDistribution).mockResolvedValue({
      oracle_signature: '0xsig',
    })

    const distributionInsertSingle = vi.fn().mockResolvedValue({ data: { id: 'dist-1' }, error: null })

    const from = vi.fn((table: string) => {
      if (table === 'universal_reward_epochs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'epoch-1',
                  chain_id: 8453,
                  pool_id: '0xpool',
                  trade_count: 2,
                  epoch_start: '2026-04-01T00:00:00.000Z',
                  epoch_end: '2026-04-02T00:00:00.000Z',
                  total_allocated_usd: 12.5,
                  merkle_root: '0x' + 'a'.repeat(64),
                  total_usdc_wei: '12500000',
                  tree_json: { format: 'standard-v1' },
                  distribution_id: null,
                  status: 'published',
                },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }

      if (table === 'universal_reward_allocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    recipient: '0xaaaa000000000000000000000000000000000001',
                    recipient_type: 'trader',
                    amount_usd: 5,
                    amount_usdc_wei: '5000000',
                    merkle_proof: ['0xproof'],
                    included_in_merkle: true,
                  },
                  {
                    recipient: '0xbbbb000000000000000000000000000000000002',
                    recipient_type: 'referrer',
                    amount_usd: 2,
                    amount_usdc_wei: '2000000',
                    merkle_proof: ['0xproof2'],
                    included_in_merkle: true,
                  },
                ],
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === 'campaigns') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }

      if (table === 'distributions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: distributionInsertSingle,
            }),
          }),
        }
      }

      if (table === 'daily_payouts') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    })

    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never)

    const result = await publishUniversalEpochToDistributor('epoch-1')

    expect(result).toEqual({
      epoch_id: 'epoch-1',
      distribution_id: 'dist-1',
      campaign_id: 'universal:8453:0xpool',
      published: true,
    })
    expect(vi.mocked(publishDistribution)).toHaveBeenCalledWith(
      expect.objectContaining({
        distribution_db_id: 'dist-1',
        campaign_id_str: 'universal:8453:0xpool',
        epoch_number: 1,
      })
    )
  })
})

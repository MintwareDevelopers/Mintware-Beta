import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { allocateUniversalEpoch, attributionBandFromPercentile, epochEndFromStart, floorToEpochStart, makeUniversalEpochKey, type TradeSignalLedgerRow } from '@/lib/rewards/universal/epochAllocator'
import type { UniversalAllocationPolicy } from '@/lib/rewards/universal/types'

const POLICY: UniversalAllocationPolicy = {
  lp_share_bps: 7000,
  referrer_share_bps: 1500,
  trader_rebate_bps: 1000,
  treasury_share_bps: 500,
  minimum_rebate_band: 'mid',
  treasury_address: '0x9999000000000000000000000000000000000009',
}

function makeSignal(overrides: Partial<TradeSignalLedgerRow> = {}): TradeSignalLedgerRow {
  return {
    id: '8453:0xabc:1',
    chain_id: 8453,
    pool_id: '0xpool',
    tx_hash: '0xabc',
    log_index: 1,
    block_number: 100,
    swapper: '0xaaaa000000000000000000000000000000000001',
    referrer: null,
    amount_in_raw: '1000000',
    amount_out_raw: '100000000',
    dynamic_fee_bps: 30,
    capture_amount_raw: '0',
    tick_after: 42,
    pyth_timestamp: 1710000000,
    hook_data: '0x',
    observed_at: '2026-04-01T00:00:00.000Z',
    created_at: '2026-04-01T01:15:00.000Z',
    ...overrides,
  }
}

describe('universal epoch allocator helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('0xaaaa000000000000000000000000000000000001')) {
        return {
          ok: true,
          json: async () => ({ percentile: 80 }),
        }
      }

      return {
        ok: true,
        json: async () => ({ percentile: 20 }),
      }
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives stable epoch window helpers deterministically', () => {
    const start = floorToEpochStart('2026-04-01T05:23:00.000Z', 24)
    expect(start).toBe('2026-04-01T00:00:00.000Z')
    expect(epochEndFromStart(start, 24)).toBe('2026-04-02T00:00:00.000Z')
    expect(makeUniversalEpochKey(8453, '0xpool', start)).toBe('8453:0xpool:2026-04-01T00:00:00.000Z')
  })

  it('maps attribution percentiles into low/mid/high bands', () => {
    expect(attributionBandFromPercentile(10)).toBe('low')
    expect(attributionBandFromPercentile(50)).toBe('mid')
    expect(attributionBandFromPercentile(90)).toBe('high')
  })

  it('classifies signals with fetched attribution context and aggregates allocations', async () => {
    const result = await allocateUniversalEpoch({
      signals: [
        makeSignal({
          referrer: '0xbbbb000000000000000000000000000000000002',
          created_at: '2026-04-01T01:15:00.000Z',
        }),
        makeSignal({
          id: '8453:0xdef:2',
          tx_hash: '0xdef',
          log_index: 2,
          swapper: '0xcccc000000000000000000000000000000000003',
          amount_out_raw: '50000000',
          capture_amount_raw: '250000',
          created_at: '2026-04-01T01:45:00.000Z',
        }),
      ],
      policy: POLICY,
    })

    expect(result.classified).toHaveLength(2)
    expect(result.classified[0].quality).toBe('referral')
    expect(result.classified[0].attribution_band).toBe('high')
    expect(result.classified[1].quality).toBe('toxic')
    expect(result.summary.total_value_usd).toBeGreaterThan(0)
    expect(result.summary.total_allocated_usd).toBe(result.summary.total_value_usd)
    expect(result.summary.entries.some((entry) => entry.recipient_type === 'lp_pool')).toBe(true)
    expect(result.summary.entries.some((entry) => entry.recipient_type === 'trader')).toBe(true)
    expect(result.summary.entries.some((entry) => entry.recipient_type === 'referrer')).toBe(true)
    expect(result.summary.entries.some((entry) => entry.recipient_type === 'treasury')).toBe(true)
  })
})

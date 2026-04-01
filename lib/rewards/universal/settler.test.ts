import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/web2/supabase', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { settleUniversalEpochs } from '@/lib/rewards/universal/settler'

function makeSupabaseMock(signalRows: object[]) {
  const insertEpochSingle = vi.fn().mockResolvedValue({ data: { id: 'epoch-1' }, error: null })
  const insertAllocations = vi.fn().mockResolvedValue({ error: null })
  const updateTradeSignalsIn = vi.fn().mockResolvedValue({ error: null })

  const tradeSignalsSelect = {
    is: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: signalRows, error: null }),
  }

  const epochInsert = {
    select: vi.fn().mockReturnValue({
      single: insertEpochSingle,
    }),
  }

  const allocationsInsert = vi.fn().mockResolvedValue({ error: null })

  const tradeSignalsUpdate = {
    in: updateTradeSignalsIn,
  }

  const from = vi.fn((table: string) => {
    if (table === 'trade_signals') {
      return {
        select: vi.fn().mockReturnValue(tradeSignalsSelect),
        update: vi.fn().mockReturnValue(tradeSignalsUpdate),
      }
    }

    if (table === 'universal_reward_epochs') {
      return {
        insert: vi.fn().mockReturnValue(epochInsert),
      }
    }

    if (table === 'universal_reward_allocations') {
      return {
        insert: allocationsInsert,
      }
    }

    throw new Error(`Unexpected table ${table}`)
  })

  return {
    mock: { from },
    spies: {
      insertEpochSingle,
      allocationsInsert,
      updateTradeSignalsIn,
    },
  }
}

describe('universal epoch settler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ percentile: 80 }),
    })))

    process.env.MINTWARE_TREASURY_ADDRESS = '0x9999000000000000000000000000000000000009'
    process.env.UNIVERSAL_SETTLE_DELAY_MINS = '10'
    process.env.UNIVERSAL_EPOCH_DURATION_HOURS = '24'
    process.env.UNIVERSAL_SETTLEMENT_DECIMALS = '6'
    process.env.UNIVERSAL_LP_SHARE_BPS = '7000'
    process.env.UNIVERSAL_REFERRER_SHARE_BPS = '1500'
    process.env.UNIVERSAL_TRADER_REBATE_BPS = '1000'
    process.env.UNIVERSAL_TREASURY_SHARE_BPS = '500'
    process.env.UNIVERSAL_MIN_REBATE_BAND = 'mid'
  })

  it('returns an empty report when no unsettled signals are eligible', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      })),
    } as never)

    const result = await settleUniversalEpochs()

    expect(result).toEqual({
      epochs_settled: 0,
      signals_settled: 0,
      results: [],
    })
  })

  it('writes epoch, allocation, and settled cursor rows for mature signals', async () => {
    const signals = [
      {
        id: '8453:0xabc:1',
        chain_id: 8453,
        pool_id: '0xpool',
        tx_hash: '0xabc',
        log_index: 1,
        block_number: 100,
        swapper: '0xaaaa000000000000000000000000000000000001',
        referrer: '0xbbbb000000000000000000000000000000000002',
        amount_in_raw: '1000000',
        amount_out_raw: '100000000',
        dynamic_fee_bps: 30,
        capture_amount_raw: '0',
        tick_after: 42,
        pyth_timestamp: 1710000000,
        hook_data: '0x',
        observed_at: '2026-04-01T00:00:00.000Z',
        created_at: '2026-03-30T00:00:00.000Z',
      },
    ]

    const { mock, spies } = makeSupabaseMock(signals)
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mock as never)

    const result = await settleUniversalEpochs()

    expect(result.epochs_settled).toBe(1)
    expect(result.signals_settled).toBe(1)
    expect(result.results[0].wallets_included).toBeGreaterThan(0)
    expect(spies.insertEpochSingle).toHaveBeenCalled()
    expect(spies.allocationsInsert).toHaveBeenCalledTimes(1)
    expect(spies.updateTradeSignalsIn).toHaveBeenCalledWith('id', ['8453:0xabc:1'])

    const allocationRows = spies.allocationsInsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(allocationRows.some((row) => row.recipient_type === 'trader')).toBe(true)
    expect(allocationRows.some((row) => row.recipient_type === 'referrer')).toBe(true)
    expect(allocationRows.some((row) => row.recipient_type === 'treasury')).toBe(true)
    expect(allocationRows.some((row) => row.recipient_type === 'lp_pool')).toBe(true)
    expect(allocationRows.every((row) => Array.isArray(row.source_trade_ids))).toBe(true)
  })
})

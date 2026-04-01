import { describe, expect, it } from 'vitest'
import { toTradeSignalRows } from '@/lib/rewards/universal/store'

describe('trade signal store helpers', () => {
  it('converts raw signals into normalized upsert rows', () => {
    const rows = toTradeSignalRows([
      {
        chain_id: 8453,
        pool_id: '0xpool',
        tx_hash: '0xABCDEF',
        log_index: 7,
        block_number: 123,
        swapper: '0xAaAa000000000000000000000000000000000001',
        referrer: '0xBBBB000000000000000000000000000000000002',
        amount_in: '1000',
        amount_out: 900n,
        dynamic_fee_bps: 30,
        capture_amount: '10',
        tick_after: 1234,
        pyth_timestamp: 1710000000,
        hook_data: '0xdeadbeef',
        observed_at: '2026-04-01T00:00:00.000Z',
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: '8453:0xabcdef:7',
      tx_hash: '0xabcdef',
      swapper: '0xaaaa000000000000000000000000000000000001',
      referrer: '0xbbbb000000000000000000000000000000000002',
      amount_in_raw: '1000',
      amount_out_raw: '900',
      capture_amount_raw: '10',
    })
  })
})

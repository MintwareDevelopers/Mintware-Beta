import { describe, expect, it } from 'vitest'
import { makeTradeSignalSyncKey, mapTradeSignalLog, resolveTradeSignalSyncRange } from '@/lib/rewards/universal/indexer'

describe('universal trade signal indexer helpers', () => {
  it('builds a deterministic sync key', () => {
    expect(makeTradeSignalSyncKey('base_sepolia', '0xABCDEF')).toBe('base_sepolia:0xabcdef')
  })

  it('resolves an initial sync range from the safe tip', () => {
    const range = resolveTradeSignalSyncRange({
      latestBlock: 10_000n,
      initialWindow: 500n,
      confirmations: 10n,
    })

    expect(range).toEqual({
      fromBlock: 9490n,
      toBlock: 9990n,
    })
  })

  it('returns null when there are no new confirmed blocks', () => {
    const range = resolveTradeSignalSyncRange({
      latestBlock: 1_000n,
      lastSyncedBlock: 999n,
      confirmations: 2n,
    })

    expect(range).toBeNull()
  })

  it('maps a viem-style log into a raw trade signal payload', () => {
    const raw = mapTradeSignalLog(84532, {
      args: {
        poolId: '0xpool',
        swapper: '0xAaAa000000000000000000000000000000000001',
        referrer: '0xBBBB000000000000000000000000000000000002',
        amountIn: 1000n,
        amountOut: 900n,
        dynamicFee: 45,
        captureAmount: 11n,
        tickAfter: 123,
        pythTimestamp: 1710000000n,
        hookData: '0xdeadbeef',
      },
      transactionHash: '0xabc',
      logIndex: 4,
      blockNumber: 12345n,
    } as never)

    expect(raw).toMatchObject({
      chain_id: 84532,
      tx_hash: '0xabc',
      log_index: 4,
      block_number: 12345,
      swapper: '0xAaAa000000000000000000000000000000000001',
      referrer: '0xBBBB000000000000000000000000000000000002',
      amount_in: '1000',
      amount_out: '900',
      capture_amount: '11',
      pyth_timestamp: 1710000000,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeTradeSignal, normalizeTradeSignals } from '@/lib/rewards/universal/tradeSignalIngestor'
import { classifyTradeSignal } from '@/lib/rewards/universal/classifier'
import { aggregateTradeSignalAllocations } from '@/lib/rewards/universal/allocator'
import { buildUniversalMerkleTree } from '@/lib/rewards/universal/merkleBuilder'
import type { RawTradeSignal, UniversalAllocationPolicy } from '@/lib/rewards/universal/types'

function makeRawSignal(overrides: Partial<RawTradeSignal> = {}): RawTradeSignal {
  return {
    chain_id: 8453,
    pool_id: '0xpool',
    tx_hash: '0xabc',
    log_index: 1,
    block_number: 100,
    swapper: '0xAaAa000000000000000000000000000000000001',
    referrer: null,
    amount_in: '1000000',
    amount_out: '950000',
    dynamic_fee_bps: 30,
    capture_amount: '0',
    tick_after: 42,
    pyth_timestamp: 1710000000,
    hook_data: '0x',
    observed_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  }
}

const POLICY: UniversalAllocationPolicy = {
  lp_share_bps: 7000,
  referrer_share_bps: 1500,
  trader_rebate_bps: 1000,
  treasury_share_bps: 500,
  minimum_rebate_band: 'mid',
  treasury_address: '0x9999000000000000000000000000000000000009',
}

describe('universal trade signal pipeline', () => {
  it('normalizes trade signal ids and addresses', () => {
    const normalized = normalizeTradeSignal(makeRawSignal())

    expect(normalized.id).toBe('8453:0xabc:1')
    expect(normalized.swapper).toBe('0xaaaa000000000000000000000000000000000001')
    expect(normalized.referrer).toBeNull()
  })

  it('sorts normalized trade signals deterministically', () => {
    const signals = normalizeTradeSignals([
      makeRawSignal({ block_number: 101, log_index: 2, tx_hash: '0xdef' }),
      makeRawSignal({ block_number: 100, log_index: 1, tx_hash: '0xabc' }),
    ])

    expect(signals[0].tx_hash).toBe('0xabc')
    expect(signals[1].tx_hash).toBe('0xdef')
  })

  it('classifies toxic flow when capture is present', () => {
    const signal = normalizeTradeSignal(makeRawSignal({ capture_amount: '5000' }))
    const classified = classifyTradeSignal(signal, {
      amount_out_usd: 100,
      capture_usd: 5,
      attribution_band: 'high',
    })

    expect(classified.quality).toBe('toxic')
    expect(classified.reasons).toContain('captured_value_detected')
  })

  it('classifies referral flow when a valid referrer is present', () => {
    const signal = normalizeTradeSignal(makeRawSignal({
      referrer: '0xBBBB000000000000000000000000000000000002',
    }))
    const classified = classifyTradeSignal(signal, {
      amount_out_usd: 100,
      attribution_band: 'mid',
      referral_eligible: true,
    })

    expect(classified.quality).toBe('referral')
    expect(classified.referrer).toBe('0xbbbb000000000000000000000000000000000002')
  })

  it('allocates value across lp, trader, referrer, and treasury recipients', () => {
    const referralSignal = classifyTradeSignal(
      normalizeTradeSignal(makeRawSignal({
        tx_hash: '0xref',
        referrer: '0xBBBB000000000000000000000000000000000002',
      })),
      { amount_out_usd: 100, attribution_band: 'high', referral_eligible: true }
    )

    const toxicSignal = classifyTradeSignal(
      normalizeTradeSignal(makeRawSignal({
        tx_hash: '0xtoxic',
        log_index: 2,
        capture_amount: '5000',
      })),
      { amount_out_usd: 80, capture_usd: 4, attribution_band: 'high' }
    )

    const summary = aggregateTradeSignalAllocations([referralSignal, toxicSignal], POLICY)

    expect(summary.total_value_usd).toBeGreaterThan(0)
    expect(summary.total_allocated_usd).toBe(summary.total_value_usd)
    expect(summary.entries.some((entry) => entry.recipient_type === 'lp_pool')).toBe(true)
    expect(summary.entries.some((entry) => entry.recipient_type === 'trader')).toBe(true)
    expect(summary.entries.some((entry) => entry.recipient_type === 'referrer')).toBe(true)
    expect(summary.entries.some((entry) => entry.recipient_type === 'treasury')).toBe(true)
  })

  it('builds a deterministic universal merkle tree from aggregated allocations', () => {
    const classified = classifyTradeSignal(
      normalizeTradeSignal(makeRawSignal({
        referrer: '0xBBBB000000000000000000000000000000000002',
      })),
      { amount_out_usd: 100, attribution_band: 'high', referral_eligible: true }
    )

    const summary = aggregateTradeSignalAllocations([classified], POLICY)
    const merkle = buildUniversalMerkleTree(summary.entries)

    expect(merkle.root).toMatch(/^0x[0-9a-f]{64}$/i)
    expect(merkle.leaves.length).toBeGreaterThan(0)
    expect(BigInt(merkle.total_usdc_wei)).toBeGreaterThan(0n)
  })
})

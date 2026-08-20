import { describe, it, expect } from 'vitest'
import {
  valueUsd,
  normalizeInternalQuote,
  quoteInternalPool,
  type RawPoolQuote,
  type QuoterReader,
} from './internalQuote'
import type { ListedPool } from './types'

const pool: ListedPool = {
  chainId: 8453,
  router: '0xrouter',
  hooks: '0xhook',
  currency0: '0xusdc',
  currency1: '0xweth',
  fee: 3000,
  tickSpacing: 60,
}

const raw = (over: Partial<RawPoolQuote> = {}): RawPoolQuote => ({
  grossOut: 100n * 10n ** 18n, // 100 tokens
  buyTokenPriceUsd: 2,
  gasCostUsd: 1,
  priceImpactPct: 0.1,
  buyTokenDecimals: 18,
  ...over,
})

describe('valueUsd', () => {
  it('values a whole-token amount', () => {
    expect(valueUsd(100n * 10n ** 18n, 18, 2)).toBeCloseTo(200, 6)
  })
  it('returns null when the price is unknown', () => {
    expect(valueUsd(1n, 18, null)).toBeNull()
    expect(valueUsd(1n, 18, NaN)).toBeNull()
  })
  it('rejects negative price and negative amount', () => {
    expect(valueUsd(1n, 18, -2)).toBeNull()
    expect(valueUsd(-1n, 18, 2)).toBeNull()
  })
  it('rejects out-of-range decimals', () => {
    expect(valueUsd(1n, -1, 2)).toBeNull()
    expect(valueUsd(1n, 37, 2)).toBeNull()
    expect(valueUsd(1n, 1.5, 2)).toBeNull()
  })
  it('values zero as zero', () => {
    expect(valueUsd(0n, 18, 2)).toBe(0)
  })
})

describe('normalizeInternalQuote', () => {
  it('skims the router fee off the output and values the net', () => {
    const q = normalizeInternalQuote(raw(), 50) // 0.5%
    expect(q.provider).toBe('mw-internal')
    // 100 tokens - 0.5% = 99.5 tokens net
    expect(q.buyAmount).toBe(995n * 10n ** 17n)
    expect(q.buyAmountUsd).toBeCloseTo(199, 6) // 99.5 * $2
    expect(q.feeUsd).toBeCloseTo(1, 6)          // 0.5 token * $2
    expect(q.gasCostUsd).toBe(1)
    expect(q.priceImpactPct).toBe(0.1)
  })

  it('carries null USD through when price is unknown', () => {
    const q = normalizeInternalQuote(raw({ buyTokenPriceUsd: null }), 50)
    expect(q.buyAmountUsd).toBeNull()
    expect(q.feeUsd).toBeNull()
    // still nets the fee in base units
    expect(q.buyAmount).toBe(995n * 10n ** 17n)
  })
})

describe('quoteInternalPool', () => {
  const reader = (r: RawPoolQuote | null): QuoterReader => ({ async quote() { return r } })

  it('returns null when there is no reader (today)', async () => {
    expect(await quoteInternalPool(pool, 1n, 50, null)).toBeNull()
  })

  it('returns null for a non-positive amount', async () => {
    expect(await quoteInternalPool(pool, 0n, 50, reader(raw()))).toBeNull()
    expect(await quoteInternalPool(pool, -5n, 50, reader(raw()))).toBeNull()
  })

  it('returns null when the reader yields nothing or zero output', async () => {
    expect(await quoteInternalPool(pool, 1n, 50, reader(null))).toBeNull()
    expect(await quoteInternalPool(pool, 1n, 50, reader(raw({ grossOut: 0n })))).toBeNull()
  })

  it('returns null when the reader throws', async () => {
    const boom: QuoterReader = { async quote() { throw new Error('rpc down') } }
    expect(await quoteInternalPool(pool, 1n, 50, boom)).toBeNull()
  })

  it('returns the normalized quote and raw on success', async () => {
    const out = await quoteInternalPool(pool, 1n, 50, reader(raw()))
    expect(out).not.toBeNull()
    expect(out!.quote.provider).toBe('mw-internal')
    expect(out!.raw.buyTokenPriceUsd).toBe(2)
  })
})

import { describe, it, expect } from 'vitest'
import { poolToCandidate } from './discovery'

const USDG = '0x00000000000000000000000000000000000usdg1'
const POOL = '0x1111111111111111111111111111111111111111'

function gtPool(over: Record<string, unknown> = {}, rel: Record<string, unknown> = {}) {
  return {
    attributes: {
      address: POOL,
      name: 'PONS / USDG',
      reserve_in_usd: '8100000',
      volume_usd: { h24: '29700000' },
      pool_created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      transactions: { h24: { buys: 3000, sells: 2000 } },
      ...over,
    },
    relationships: {
      dex: { data: { id: 'uniswap_v4' } },
      base_token: { data: { id: `robinhood_0xpons` } },
      quote_token: { data: { id: `robinhood_${USDG}` } },
      ...rel,
    },
  }
}

describe('poolToCandidate', () => {
  it('maps a hot v4 USDG pool → eligible review candidate', () => {
    const c = poolToCandidate(gtPool(), { usdgAddress: USDG })
    expect(c.poolAddress).toBe(POOL)
    expect(c.verdict).toBe('review')
    expect(c.signals.protocol).toBe('v4')
    expect(c.signals.usdgQuoted).toBe(true)
    expect(c.tvlUsd).toBe(8_100_000)
    expect(c.vol24Usd).toBe(29_700_000)
    expect(c.signals.volTvlRatio).toBeCloseTo(3.666, 1)
    expect(c.signals.txCount24).toBe(5000)
  })

  it('non-v4 → ineligible', () => {
    const c = poolToCandidate(gtPool({}, { dex: { data: { id: 'uniswap_v3' } } }), { usdgAddress: USDG })
    expect(c.verdict).toBe('ineligible')
    expect(c.signals.protocol).toBe('v3')
  })

  it('non-USDG (by address) → ineligible', () => {
    const c = poolToCandidate(
      gtPool({}, { quote_token: { data: { id: 'robinhood_0xnotusdg' } } }),
      { usdgAddress: USDG },
    )
    expect(c.signals.usdgQuoted).toBe(false)
    expect(c.verdict).toBe('ineligible')
  })

  it('detects USDG by name when no address given', () => {
    const c = poolToCandidate(gtPool({ name: 'SHROOM / USDG' }))
    expect(c.signals.usdgQuoted).toBe(true)
    const noUsdg = poolToCandidate(gtPool({ name: 'FOO / WETH' }))
    expect(noUsdg.signals.usdgQuoted).toBe(false)
  })

  it('computes pool age in days from created timestamp', () => {
    const c = poolToCandidate(gtPool({ pool_created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }), { usdgAddress: USDG })
    expect(c.signals.poolAgeDays).toBe(2)
    // a 2-day-old pool picks up the "very new" penalty
    expect(c.score).toBeGreaterThan(0)
  })
})

// Untrusted-input hardening (audit L-09) — GeckoTerminal payloads are external, never trusted.
describe('poolToCandidate — untrusted input validation', () => {
  it('rejects a non-address pool address (→ empty, so ingest skips it)', () => {
    expect(poolToCandidate(gtPool({ address: '0xPOOL' })).poolAddress).toBe('')
    expect(poolToCandidate(gtPool({ address: 'not-an-address' })).poolAddress).toBe('')
    expect(poolToCandidate(gtPool({ address: undefined })).poolAddress).toBe('')
    // a valid address is preserved (lowercased)
    expect(poolToCandidate(gtPool({ address: POOL.toUpperCase().replace('0X', '0x') })).poolAddress).toBe(POOL)
  })

  it('coerces non-finite / garbage numeric metrics to 0 — never NaN or Infinity', () => {
    const c = poolToCandidate(gtPool({ reserve_in_usd: 'not-a-number', volume_usd: { h24: 'NaN' }, base_token_price_quote_token: 'x' }), { usdgAddress: USDG })
    expect(Number.isFinite(c.tvlUsd)).toBe(true)
    expect(c.tvlUsd).toBe(0)
    expect(Number.isFinite(c.vol24Usd)).toBe(true)
    expect(c.vol24Usd).toBe(0)
    // tvl 0 ⇒ ratio null (guarded), never NaN/Infinity
    expect(c.signals.volTvlRatio).toBeNull()
    // bad price ⇒ null, not NaN
    expect(c.priceQuotePerBase).toBeNull()
  })

  it('coerces garbage transaction counts to a finite total', () => {
    const c = poolToCandidate(gtPool({ transactions: { h24: { buys: 'oops', sells: undefined } } }), { usdgAddress: USDG })
    expect(c.signals.txCount24).toBe(0)
  })

  it('strips control chars from the pair label and caps its length', () => {
    // NUL, newline, zero-width space, BOM — all removed; normal ASCII kept (space is NOT a control char)
    const dirty = 'AB' + '\u0000' + 'CD' + '\n' + 'EF' + '\u200B' + '\uFEFF' + 'GH'
    expect(poolToCandidate(gtPool({ name: dirty })).pairLabel).toBe('ABCDEFGH')
    const long = 'Z'.repeat(200)
    expect(poolToCandidate(gtPool({ name: long })).pairLabel.length).toBe(64)
  })
})

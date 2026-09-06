import { describe, it, expect } from 'vitest'
import { poolToCandidate } from './discovery'

const USDG = '0x00000000000000000000000000000000000usdg1'

function gtPool(over: Record<string, unknown> = {}, rel: Record<string, unknown> = {}) {
  return {
    attributes: {
      address: '0xPOOL',
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
    expect(c.poolAddress).toBe('0xpool')
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

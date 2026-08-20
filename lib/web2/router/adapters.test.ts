import { describe, it, expect } from 'vitest'
import { lifiSideFromQuote } from './adapters'

describe('lifiSideFromQuote', () => {
  it('parses buyAmount + gasCostUSD from a LI.FI quote', () => {
    expect(lifiSideFromQuote({ buyAmount: '990000000000000000', gasCostUSD: '2.5' }))
      .toEqual({ buyAmount: 990000000000000000n, gasCostUsd: 2.5 })
  })

  it('treats a missing gas cost as null', () => {
    expect(lifiSideFromQuote({ buyAmount: '100' })).toEqual({ buyAmount: 100n, gasCostUsd: null })
    expect(lifiSideFromQuote({ buyAmount: '100', gasCostUSD: null })).toEqual({ buyAmount: 100n, gasCostUsd: null })
  })

  it('treats a non-numeric gas cost as null', () => {
    expect(lifiSideFromQuote({ buyAmount: '100', gasCostUSD: 'n/a' }).gasCostUsd).toBeNull()
  })

  it('degrades a malformed buyAmount to 0n (never throws)', () => {
    expect(lifiSideFromQuote({ buyAmount: 'not-a-number' }).buyAmount).toBe(0n)
    expect(lifiSideFromQuote({ buyAmount: '' }).buyAmount).toBe(0n)
    expect(lifiSideFromQuote({ buyAmount: '1.5' }).buyAmount).toBe(0n) // BigInt rejects decimals
  })
})

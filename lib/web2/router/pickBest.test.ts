import { describe, it, expect } from 'vitest'
import { pickBest, INTERNAL_MAX_PRICE_IMPACT_PCT } from './pickBest'
import type { NetQuote } from './types'

function lifi(over: Partial<NetQuote> = {}): NetQuote {
  return {
    provider: 'lifi',
    buyAmount: 100n,
    buyAmountUsd: 100,
    gasCostUsd: 1,
    feeUsd: null,
    priceImpactPct: null,
    ...over,
  }
}
function internal(over: Partial<NetQuote> = {}): NetQuote {
  return {
    provider: 'mw-internal',
    buyAmount: 100n,
    buyAmountUsd: 100,
    gasCostUsd: 1,
    feeUsd: null,
    priceImpactPct: null,
    ...over,
  }
}

describe('pickBest — availability guards', () => {
  it('LI.FI wins when there is no internal quote', () => {
    expect(pickBest(lifi(), null)).toEqual({ winner: 'lifi', reason: 'lifi-internal-unavailable' })
  })

  it('LI.FI wins when both are null (internal checked first)', () => {
    expect(pickBest(null, null)).toEqual({ winner: 'lifi', reason: 'lifi-internal-unavailable' })
  })

  it('internal wins only-because it is the sole route when LI.FI failed', () => {
    expect(pickBest(null, internal())).toEqual({ winner: 'mw-internal', reason: 'internal-only-lifi-failed' })
  })
})

describe('pickBest — price-impact suppression', () => {
  it('suppresses internal above the impact ceiling even if it quotes better', () => {
    const res = pickBest(
      lifi({ buyAmountUsd: 100 }),
      internal({ buyAmountUsd: 999, priceImpactPct: INTERNAL_MAX_PRICE_IMPACT_PCT + 0.01 }),
    )
    expect(res).toEqual({ winner: 'lifi', reason: 'lifi-internal-high-impact' })
  })

  it('does NOT suppress internal exactly at the ceiling (strict >)', () => {
    const res = pickBest(
      lifi({ buyAmountUsd: 100 }),
      internal({ buyAmountUsd: 200, priceImpactPct: INTERNAL_MAX_PRICE_IMPACT_PCT }),
    )
    expect(res.winner).toBe('mw-internal')
  })
})

describe('pickBest — cannot compare without a shared USD basis', () => {
  it('LI.FI wins when LI.FI has no USD value', () => {
    const res = pickBest(lifi({ buyAmountUsd: null }), internal({ buyAmountUsd: 200 }))
    expect(res).toEqual({ winner: 'lifi', reason: 'lifi-cannot-compare' })
  })

  it('LI.FI wins when internal has no USD value', () => {
    const res = pickBest(lifi({ buyAmountUsd: 100 }), internal({ buyAmountUsd: null }))
    expect(res).toEqual({ winner: 'lifi', reason: 'lifi-cannot-compare' })
  })

  it('never picks internal on raw output alone (gas-blind path is refused)', () => {
    // Internal has far more raw output but no USD — must NOT win.
    const res = pickBest(
      lifi({ buyAmount: 1n, buyAmountUsd: null }),
      internal({ buyAmount: 10n ** 30n, buyAmountUsd: null }),
    )
    expect(res.winner).toBe('lifi')
  })
})

describe('pickBest — user-net comparison (gas inclusive)', () => {
  it('internal wins when its gas-inclusive net is strictly greater', () => {
    const res = pickBest(
      lifi({ buyAmountUsd: 198, gasCostUsd: 1 }),  // net 197
      internal({ buyAmountUsd: 199, gasCostUsd: 1 }), // net 198
    )
    expect(res).toEqual({ winner: 'mw-internal', reason: 'internal-better' })
  })

  it('LI.FI wins an exact user-net tie', () => {
    const res = pickBest(
      lifi({ buyAmountUsd: 100, gasCostUsd: 2 }),  // net 98
      internal({ buyAmountUsd: 99, gasCostUsd: 1 }), // net 98
    )
    expect(res).toEqual({ winner: 'lifi', reason: 'lifi-tie' })
  })

  it('LI.FI wins when it is simply better', () => {
    const res = pickBest(
      lifi({ buyAmountUsd: 200, gasCostUsd: 1 }),
      internal({ buyAmountUsd: 150, gasCostUsd: 1 }),
    )
    expect(res).toEqual({ winner: 'lifi', reason: 'lifi-better' })
  })

  it('gas can flip a higher-output internal quote to a loss', () => {
    // internal has more output USD but much higher gas → worse net → LI.FI wins
    const res = pickBest(
      lifi({ buyAmountUsd: 198, gasCostUsd: 1 }),   // net 197
      internal({ buyAmountUsd: 199, gasCostUsd: 10 }), // net 189
    )
    expect(res).toEqual({ winner: 'lifi', reason: 'lifi-better' })
  })

  it('treats a null gas cost as zero', () => {
    const res = pickBest(
      lifi({ buyAmountUsd: 100, gasCostUsd: null }),   // net 100
      internal({ buyAmountUsd: 101, gasCostUsd: null }), // net 101
    )
    expect(res.winner).toBe('mw-internal')
  })
})

describe('pickBest — margin knob', () => {
  it('rejects internal when it beats LI.FI by less than the margin', () => {
    // lifiNet = 1000, internalNet = 1000.5; margin 10bps of 1000 = 1.0 → need > 1001
    const res = pickBest(
      lifi({ buyAmountUsd: 1000, gasCostUsd: 0 }),
      internal({ buyAmountUsd: 1000.5, gasCostUsd: 0 }),
      { minMarginBps: 10 },
    )
    expect(res.winner).toBe('lifi')
    expect(res.reason).toBe('lifi-better')
  })

  it('accepts internal when it clears the margin', () => {
    const res = pickBest(
      lifi({ buyAmountUsd: 1000, gasCostUsd: 0 }),
      internal({ buyAmountUsd: 1002, gasCostUsd: 0 }), // +2 > 1.0 threshold
      { minMarginBps: 10 },
    )
    expect(res.winner).toBe('mw-internal')
  })
})

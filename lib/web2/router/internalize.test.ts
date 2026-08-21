import { describe, it, expect } from 'vitest'
import {
  decideInternalize,
  DEFAULT_MAX_SIZE_USD,
  type InternalizeInput,
  type InternalizeOptions,
} from './internalize'
import { pickBest } from './pickBest'
import type { NetQuote } from './types'

// A benign, internalizable base case: vault mid (1_020) strictly beats external
// (1_000), and a 50bps spread still leaves the user above external.
function input(over: Partial<InternalizeInput> = {}): InternalizeInput {
  return {
    externalBestOut: 1_000n,
    vaultQuoteOut: 1_020n,
    spreadBps: 50,
    tokenIn: 'USDC',
    tokenOut: 'WETH',
    sizeUsd: 5_000,
    ...over,
  }
}
const ON: InternalizeOptions = { enabled: true }

describe('decideInternalize — disabled by default (LI.FI path unchanged)', () => {
  it('is OFF with no opts → falls back to external, no capture', () => {
    const d = decideInternalize(input())
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('internalize-disabled')
    expect(d.fillOut).toBe(1_000n)          // user gets external best
    expect(d.capturedSpreadOut).toBe(0n)
    expect(d.improvementOut).toBe(0n)
  })

  it('explicit enabled:false also falls back', () => {
    const d = decideInternalize(input(), { enabled: false })
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('internalize-disabled')
  })
})

describe('decideInternalize — HARD best-execution guarantee', () => {
  it('never returns a fill worse than external, across a wide sweep', () => {
    const ext = 1_000n
    for (let mid = 800; mid <= 1_400; mid += 7) {
      for (const spreadBps of [0, 25, 50, 100, 250, 900, 5_000, 10_000]) {
        const d = decideInternalize(
          input({ externalBestOut: ext, vaultQuoteOut: BigInt(mid), spreadBps }),
          ON,
        )
        // THE invariant: the user is never worse off than the external best.
        expect(d.fillOut >= ext).toBe(true)
        if (d.internalize) {
          expect(d.reason).toBe('internalized')
          // captured spread comes only from mid−fill, never from below external
          expect(d.capturedSpreadOut).toBe(BigInt(mid) - d.fillOut)
          expect(d.capturedSpreadOut >= 0n).toBe(true)
          expect(d.fillOut <= BigInt(mid)).toBe(true)   // vault never sells below cost
          expect(d.improvementOut).toBe(d.fillOut - ext)
        } else {
          expect(d.fillOut).toBe(ext)                   // fallback delivers external
          expect(d.capturedSpreadOut).toBe(0n)
        }
      }
    }
  })

  it('refuses when the vault mid cannot even match external (best-ex floor)', () => {
    const d = decideInternalize(input({ vaultQuoteOut: 999n, externalBestOut: 1_000n }), ON)
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('external-better')
    expect(d.fillOut).toBe(1_000n)
  })

  it('a mid exactly equal to external captures nothing → routes out (no free inventory risk)', () => {
    const d = decideInternalize(input({ vaultQuoteOut: 1_000n, externalBestOut: 1_000n, spreadBps: 0 }), ON)
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('spread-too-thin')
    expect(d.fillOut).toBe(1_000n)
  })
})

describe('decideInternalize — spread capture math', () => {
  it('captures the full desired spread when it still clears external', () => {
    // mid 1_020, 50bps → intended fill 1_020*(9950/10000)=1_014 (floor), > external 1_000
    const d = decideInternalize(input({ vaultQuoteOut: 1_020n, spreadBps: 50 }), ON)
    expect(d.internalize).toBe(true)
    expect(d.fillOut).toBe(1_014n)
    expect(d.capturedSpreadOut).toBe(6n)             // 1_020 − 1_014
    expect(d.capturedSpreadBps).toBe(58)             // floor(6*10000/1020)
    expect(d.improvementOut).toBe(14n)               // user still beats external by 14
  })

  it('clamps the fill UP to external when the desired spread would undercut it', () => {
    // mid 1_010, 900bps → intended fill 1_010*(9100/10000)=919 (floor) < external 1_000
    // → fill floored at external 1_000, captured = 1_010 − 1_000 = 10
    const d = decideInternalize(input({ vaultQuoteOut: 1_010n, spreadBps: 900, externalBestOut: 1_000n }), ON)
    expect(d.internalize).toBe(true)
    expect(d.fillOut).toBe(1_000n)                   // best-ex floor
    expect(d.capturedSpreadOut).toBe(10n)
    expect(d.improvementOut).toBe(0n)                // exactly meets external
  })

  it('zero spread captures nothing → routed out (no free inventory risk)', () => {
    // spread 0 → intendedFill == mid → fillOut == mid → captured 0 → not worth it.
    const d = decideInternalize(input({ vaultQuoteOut: 1_030n, spreadBps: 0, externalBestOut: 1_000n }), ON)
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('spread-too-thin')
    expect(d.fillOut).toBe(1_000n)                   // fallback delivers external
  })
})

describe('decideInternalize — toxicity / size gate', () => {
  it('refuses an explicit toxic flag', () => {
    const d = decideInternalize(input({ toxicity: { toxic: true, label: 'oracle-burst' } }), ON)
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('toxic-flow')
    expect(d.fillOut).toBe(1_000n)
  })

  it('a non-toxic signal does not block internalizing', () => {
    const d = decideInternalize(input({ toxicity: { toxic: false } }), ON)
    expect(d.internalize).toBe(true)
  })

  it('refuses flow over the default size cap', () => {
    const d = decideInternalize(input({ sizeUsd: DEFAULT_MAX_SIZE_USD + 1 }), ON)
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('size-over-cap')
  })

  it('honors a custom (smaller) size cap', () => {
    const d = decideInternalize(input({ sizeUsd: 2_000 }), { enabled: true, maxSizeUsd: 1_000 })
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('size-over-cap')
  })

  it('exactly at the cap is allowed (strict >)', () => {
    const d = decideInternalize(input({ sizeUsd: 1_000 }), { enabled: true, maxSizeUsd: 1_000 })
    expect(d.internalize).toBe(true)
  })
})

describe('decideInternalize — minCaptureBps threshold', () => {
  it('routes out when captured spread is below the minimum', () => {
    // mid 1_020, spread 50 → captured 58bps of mid; require 100 → too thin
    const d = decideInternalize(input({ vaultQuoteOut: 1_020n, spreadBps: 50 }), {
      enabled: true,
      minCaptureBps: 100,
    })
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('spread-too-thin')
    expect(d.fillOut).toBe(1_000n)
  })

  it('internalizes when captured spread meets the minimum', () => {
    const d = decideInternalize(input({ vaultQuoteOut: 1_020n, spreadBps: 50 }), {
      enabled: true,
      minCaptureBps: 50,
    })
    expect(d.internalize).toBe(true)
    expect(d.capturedSpreadBps).toBeGreaterThanOrEqual(50)
  })
})

describe('decideInternalize — invalid input is routed out safely', () => {
  it.each([
    ['zero external', { externalBestOut: 0n }],
    ['negative external', { externalBestOut: -5n }],
    ['negative vault quote', { vaultQuoteOut: -1n }],
    ['NaN size', { sizeUsd: Number.NaN }],
    ['negative size', { sizeUsd: -1 }],
    ['negative spread', { spreadBps: -10 }],
    ['NaN spread', { spreadBps: Number.NaN }],
  ])('%s → invalid-input, external fallback', (_label, over) => {
    const d = decideInternalize(input(over as Partial<InternalizeInput>), ON)
    expect(d.internalize).toBe(false)
    expect(d.reason).toBe('invalid-input')
    expect(d.capturedSpreadOut).toBe(0n)
  })
})

describe('decideInternalize — determinism', () => {
  it('identical inputs → identical output (no clock/random)', () => {
    const a = decideInternalize(input(), ON)
    const b = decideInternalize(input(), ON)
    expect(a).toEqual(b)
  })

  it('is a pure function of args — repeated calls do not drift', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const d = decideInternalize(input({ vaultQuoteOut: 1_042n, spreadBps: 30 }), ON)
      seen.add(JSON.stringify({ ...d, fillOut: d.fillOut.toString(), capturedSpreadOut: d.capturedSpreadOut.toString(), improvementOut: d.improvementOut.toString() }))
    }
    expect(seen.size).toBe(1)
  })
})

describe('decideInternalize — composes with pickBest (final best-ex gate)', () => {
  function net(buyAmount: bigint, provider: NetQuote['provider']): NetQuote {
    return { provider, buyAmount, buyAmountUsd: Number(buyAmount), gasCostUsd: 0, feeUsd: null, priceImpactPct: null }
  }

  it('a positive decision feeds pickBest a quote pickBest never rates below external', () => {
    const d = decideInternalize(input({ vaultQuoteOut: 1_050n, spreadBps: 40, externalBestOut: 1_000n }), ON)
    expect(d.internalize).toBe(true)
    const lifi = net(1_000n, 'lifi')
    const internal = net(d.fillOut, 'mw-internal')
    const pick = pickBest(lifi, internal)
    // fillOut strictly beats external → pickBest agrees internal wins
    expect(pick.winner).toBe('mw-internal')
    expect(pick.reason).toBe('internal-better')
  })

  it('when disabled, the internal quote equals external → pickBest ties to LI.FI (path unchanged)', () => {
    const d = decideInternalize(input(), { enabled: false })
    const lifi = net(1_000n, 'lifi')
    const internal = net(d.fillOut, 'mw-internal')   // fillOut === external
    const pick = pickBest(lifi, internal)
    expect(pick.winner).toBe('lifi')
    expect(pick.reason).toBe('lifi-tie')
  })
})

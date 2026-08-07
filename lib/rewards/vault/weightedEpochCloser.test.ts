// =============================================================================
// weightedEpochCloser.test.ts — LP-input assembly (fail-closed join) + claim index.
// Pure functions — no Supabase, no chain.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { assembleLpInputs, buildClaimIndex, type RawLpPosition } from '@/lib/rewards/vault/weightedEpochCloser'
import type { WeightedEpochResult } from '@/lib/rewards/vault/weightedEpochOrchestrator'

const A = '0x00000000000000000000000000000000000000A1'
const B = '0x00000000000000000000000000000000000000b0'
const C = '0x00000000000000000000000000000000000000c2'

const raw: RawLpPosition[] = [
  { wallet: A, liquidityUnits: 100, lockTier: 'flex', daysHeld: 10 },
  { wallet: B, liquidityUnits: 300, lockTier: 'core', daysHeld: 200 },
]

describe('assembleLpInputs', () => {
  it('joins referral + percentile, lowercasing wallets', () => {
    const refs = new Map([[B.toLowerCase(), C.toLowerCase()]])
    const pct = new Map([[A.toLowerCase(), 40], [B.toLowerCase(), 80]])
    const { lps, scoresAvailable } = assembleLpInputs(raw, refs, pct)
    expect(scoresAvailable).toBe(true)
    expect(lps[0].wallet).toBe(A.toLowerCase())
    expect(lps[0].attrPercentile).toBe(40)
    expect(lps[0].referrer).toBeUndefined()
    expect(lps[1].attrPercentile).toBe(80)
    expect(lps[1].referrer).toBe(C.toLowerCase())
  })

  it('fail-closed when the score source failed wholesale (null map)', () => {
    const { scoresAvailable } = assembleLpInputs(raw, new Map(), null)
    expect(scoresAvailable).toBe(false)
  })

  it('fail-closed when an individual wallet has no percentile (NaN, never fabricated 0)', () => {
    const pct = new Map([[A.toLowerCase(), 40]]) // B missing
    const { lps, scoresAvailable } = assembleLpInputs(raw, new Map(), pct)
    expect(scoresAvailable).toBe(false)
    expect(Number.isNaN(lps[1].attrPercentile)).toBe(true)
  })
})

describe('buildClaimIndex', () => {
  it('maps each leaf wallet to its amounts + proof', () => {
    const result = {
      leaves: [
        { wallet: A.toLowerCase(), amount0Wei: '10', amount1Wei: '20', proof: ['0xaa'] },
        { wallet: B.toLowerCase(), amount0Wei: '30', amount1Wei: '40', proof: ['0xbb'] },
      ],
    } as unknown as WeightedEpochResult
    const idx = buildClaimIndex(result)
    expect(idx[A.toLowerCase()]).toEqual({ amount0Wei: '10', amount1Wei: '20', proof: ['0xaa'] })
    expect(idx[B.toLowerCase()].proof).toEqual(['0xbb'])
    expect(Object.keys(idx).length).toBe(2)
  })
})

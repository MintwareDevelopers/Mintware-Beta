// =============================================================================
// Chainalysis Sanctions Oracle adapter — mapping + fetcher via injected reader.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  toSanctionsFlag, oracleFor, buildSanctionsFetcher, SANCTIONS_ORACLE, type SanctionReader,
} from './chainalysis'
import { computeScore } from '../score'
import { GOLDEN_SANCTIONED } from '../mockProvider'

const CLEAN = '0x1111111111111111111111111111111111111111'
const BAD = '0x2222222222222222222222222222222222222222'

describe('oracle address map', () => {
  it('uses the distinct Base oracle and the standard one elsewhere', () => {
    expect(oracleFor(8453)).toBe(SANCTIONS_ORACLE[8453])
    expect(oracleFor(8453)).not.toBe(oracleFor(1)) // Base is a different contract
    expect(oracleFor(1)).toBe(oracleFor(42161))    // ethereum == arbitrum deployment
    expect(oracleFor(999999)).toBeUndefined()
  })
})

describe('toSanctionsFlag', () => {
  it('maps true → a max-severity sanctioned flag, false → none', () => {
    expect(toSanctionsFlag(true)).toEqual({ type: 'sanctioned', severity: 1 })
    expect(toSanctionsFlag(false)).toBeNull()
  })
})

describe('buildSanctionsFetcher (injected reader)', () => {
  const reader: SanctionReader = async ({ address }) => address.toLowerCase() === BAD

  it('flags a sanctioned address and clears a clean one', async () => {
    const fetch = buildSanctionsFetcher(reader)
    expect(await fetch(BAD)).toEqual({ type: 'sanctioned', severity: 1 })
    expect(await fetch(CLEAN)).toBeNull()
  })

  it('fails open (null) when the reader throws — never blocks a score', async () => {
    const throwing: SanctionReader = async () => { throw new Error('rpc down') }
    expect(await buildSanctionsFetcher(throwing)(BAD)).toBeNull()
  })

  it('end-to-end: the flag caps the risk penalty and tanks the tier', async () => {
    const flag = await buildSanctionsFetcher(reader)(BAD)
    const clean = computeScore({ ...GOLDEN_SANCTIONED, riskFlags: [] }, Date.UTC(2025, 0, 1))
    const flagged = computeScore({ ...GOLDEN_SANCTIONED, riskFlags: [flag!] }, Date.UTC(2025, 0, 1))
    expect(flagged.riskPenalty).toBe(200)                 // sanctioned severity 1 × weight 200, capped
    expect(flagged.score).toBeLessThan(clean.score - 150)
  })
})

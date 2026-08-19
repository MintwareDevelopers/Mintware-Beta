// =============================================================================
// EAS attestation mapping — the schema-drift bug fix.
//
// mapV2SignalsToLegacyFields is the pure, testable core of the fix: v2's
// actual signal keys (volume/holding/activity/longevity/liquidity/network/
// governance) no longer match the legacy on-chain schema's field names
// (scoreTrading/scoreSharing didn't exist in v2, and the old code used
// `.find(key === 'trading')`, which silently returned undefined forever).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { mapV2SignalsToLegacyFields } from './eas'

const V2_SIGNALS = [
  { key: 'volume', score: 41 },
  { key: 'holding', score: 39 },
  { key: 'activity', score: 30 },
  { key: 'longevity', score: 60 },
  { key: 'liquidity', score: 111 },
  { key: 'network', score: 25 },
  { key: 'governance', score: 10 },
]

describe('mapV2SignalsToLegacyFields', () => {
  it('maps same-name v2 signals straight through', () => {
    const legacy = mapV2SignalsToLegacyFields(V2_SIGNALS)
    expect(legacy.scoreVolume).toBe(41)
    expect(legacy.scoreHolding).toBe(39)
    expect(legacy.scoreLiquidity).toBe(111)
    expect(legacy.scoreGovernance).toBe(10)
  })

  it('maps v2 "network" to the legacy "sharing" field (the renamed signal)', () => {
    const legacy = mapV2SignalsToLegacyFields(V2_SIGNALS)
    expect(legacy.scoreSharing).toBe(25)
  })

  it('explicitly zeros scoreTrading — no v2 equivalent, not a silent bug', () => {
    const legacy = mapV2SignalsToLegacyFields(V2_SIGNALS)
    expect(legacy.scoreTrading).toBe(0)
  })

  it('never throws on missing keys — defaults to 0, does not silently pass through a garbage value', () => {
    const legacy = mapV2SignalsToLegacyFields([])
    expect(legacy).toEqual({
      scoreVolume: 0, scoreTrading: 0, scoreHolding: 0,
      scoreLiquidity: 0, scoreGovernance: 0, scoreSharing: 0,
    })
  })

  it('is order-independent (looks up by key, not position)', () => {
    const shuffled = [...V2_SIGNALS].reverse()
    expect(mapV2SignalsToLegacyFields(shuffled)).toEqual(mapV2SignalsToLegacyFields(V2_SIGNALS))
  })
})

import { describe, it, expect } from 'vitest'
import { parkedSizeTrustSource, attributionTrustSource, DEFAULT_PARKED_THRESHOLDS } from './trustSources'
import { ParkedReader } from './treasury'
import { policyForPercentile } from './pricing'

const AGENT = '0xAbCdEf0000000000000000000000000000000007'
const parked = (v: bigint): ParkedReader => ({ parkedAtomic: async () => v })

describe('parkedSizeTrustSource', () => {
  it('maps parked balance to the pricing buckets (skin in the game)', async () => {
    expect(await parkedSizeTrustSource(parked(2_000_000_000n)).percentileOf(AGENT)).toBe(80) // >= $1k → trusted
    expect(await parkedSizeTrustSource(parked(250_000_000n)).percentileOf(AGENT)).toBe(50) //  >= $100 → standard
    expect(await parkedSizeTrustSource(parked(1_000_000n)).percentileOf(AGENT)).toBe(20) //   < $100 → unknown
    expect(await parkedSizeTrustSource(parked(0n)).percentileOf(AGENT)).toBe(20)
  })

  it('those percentiles resolve to the expected trust tiers', async () => {
    expect(policyForPercentile(await parkedSizeTrustSource(parked(2_000_000_000n)).percentileOf(AGENT)).tier).toBe('trusted')
    expect(policyForPercentile(await parkedSizeTrustSource(parked(250_000_000n)).percentileOf(AGENT)).tier).toBe('standard')
    expect(policyForPercentile(await parkedSizeTrustSource(parked(1n)).percentileOf(AGENT)).tier).toBe('unknown')
  })

  it('honors custom thresholds and defaults are exported', async () => {
    const src = parkedSizeTrustSource(parked(50n), { trustedAtomic: 100n, standardAtomic: 10n })
    expect(await src.percentileOf(AGENT)).toBe(50)
    expect(DEFAULT_PARKED_THRESHOLDS.trustedAtomic).toBe(1_000_000_000n)
  })

  it('degrades to unknown (0) when the reader throws', async () => {
    const throwing: ParkedReader = { parkedAtomic: async () => { throw new Error('rpc down') } }
    expect(await parkedSizeTrustSource(throwing).percentileOf(AGENT)).toBe(0)
  })
})

describe('attributionTrustSource (opt-in, not required)', () => {
  it('passes through a percentile, clamped, guarding failures', async () => {
    expect(await attributionTrustSource(async () => 72).percentileOf(AGENT)).toBe(72)
    expect(await attributionTrustSource(async () => 250).percentileOf(AGENT)).toBe(100)
    expect(await attributionTrustSource(async () => Number.NaN).percentileOf(AGENT)).toBe(0)
    expect(await attributionTrustSource(async () => { throw new Error('x') }).percentileOf(AGENT)).toBe(0)
  })
})

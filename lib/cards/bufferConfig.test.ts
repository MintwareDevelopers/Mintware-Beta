import { describe, it, expect } from 'vitest'
import { parseBufferConfig } from './bufferConfig'

describe('parseBufferConfig', () => {
  it('maps recognized fields to DB columns (amounts → strings, secs → ints)', () => {
    const r = parseBufferConfig({
      autoRefillEnabled: true, serviceLevelBps: 9900,
      perTxCapAtomic: '50000000', minRefillAtomic: 1000000, refillRateCapAtomic: '500000000',
      refillWindowSecs: 3600, sigmaPeriodSecs: 86400, leadTimeSecs: 60,
      meanDemandLeadtimeAtomic: '100000000', demandStdevAtomic: '80000000',
      bufferAddress: '0xABCDEF0123456789abcdef0123456789ABCDEF01',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch).toMatchObject({
      auto_refill_enabled: true, service_level_bps: 9900,
      per_tx_cap_atomic: '50000000', min_refill_atomic: '1000000', refill_rate_cap_atomic: '500000000',
      refill_window_secs: 3600, sigma_period_secs: 86400, lead_time_secs: 60,
      mean_demand_leadtime_atomic: '100000000', demand_stdev_atomic: '80000000',
      buffer_address: '0xabcdef0123456789abcdef0123456789abcdef01', // lowercased
    })
  })

  it('is a partial update — only provided fields appear', () => {
    const r = parseBufferConfig({ autoRefillEnabled: false })
    expect(r).toEqual({ ok: true, patch: { auto_refill_enabled: false } })
  })

  it('rejects a non-object body', () => {
    expect(parseBufferConfig('nope').ok).toBe(false)
    expect(parseBufferConfig(null).ok).toBe(false)
    expect(parseBufferConfig([]).ok).toBe(false)
  })

  it('rejects an empty patch', () => {
    expect(parseBufferConfig({}).ok).toBe(false)
    expect(parseBufferConfig({ unknownField: 1 }).ok).toBe(false)
  })

  it('validates serviceLevelBps range [1, 9999]', () => {
    expect(parseBufferConfig({ serviceLevelBps: 0 }).ok).toBe(false)
    expect(parseBufferConfig({ serviceLevelBps: 10000 }).ok).toBe(false)
    expect(parseBufferConfig({ serviceLevelBps: 5000 })).toEqual({ ok: true, patch: { service_level_bps: 5000 } })
  })

  it('rejects negative or non-integer amounts', () => {
    expect(parseBufferConfig({ perTxCapAtomic: '-1' }).ok).toBe(false)
    expect(parseBufferConfig({ perTxCapAtomic: 'abc' }).ok).toBe(false)
    expect(parseBufferConfig({ perTxCapAtomic: '0' })).toEqual({ ok: true, patch: { per_tx_cap_atomic: '0' } })
  })

  it('rejects non-positive seconds', () => {
    expect(parseBufferConfig({ refillWindowSecs: 0 }).ok).toBe(false)
    expect(parseBufferConfig({ leadTimeSecs: -5 }).ok).toBe(false)
  })

  it('rejects a malformed buffer address', () => {
    expect(parseBufferConfig({ bufferAddress: '0x123' }).ok).toBe(false)
    expect(parseBufferConfig({ bufferAddress: 'not-an-addr' }).ok).toBe(false)
  })

  it('accepts a manual breaker toggle', () => {
    expect(parseBufferConfig({ breakerOpen: true })).toEqual({ ok: true, patch: { breaker_open: true } })
  })
})

import { describe, it, expect } from 'vitest'
import { computeRisk, type PoolSignals } from './riskScore'

const base: PoolSignals = {
  protocol: 'v4',
  usdgQuoted: true,
  poolAgeDays: 30,
  tvlUsd: 8_100_000,
  vol24Usd: 29_700_000,
  volTvlRatio: 3.7,
  txCount24: 5000,
}

describe('computeRisk', () => {
  it('ineligible: not v4', () => {
    const r = computeRisk({ ...base, protocol: 'v3' })
    expect(r.verdict).toBe('ineligible')
    expect(r.score).toBe(100)
  })
  it('ineligible: not USDG-quoted', () => {
    const r = computeRisk({ ...base, usdgQuoted: false })
    expect(r.verdict).toBe('ineligible')
  })

  it('a deep, established USDG v4 pool scores low but still routes to review', () => {
    const r = computeRisk(base)
    expect(r.verdict).toBe('review') // NEVER auto-approve on cheap signals
    expect(r.score).toBe(0)
  })

  it('penalizes thin TVL + very new + wash-y vol/TVL + low tx', () => {
    const r = computeRisk({
      ...base,
      tvlUsd: 20_000,
      poolAgeDays: 1,
      volTvlRatio: 40,
      txCount24: 5,
    })
    expect(r.verdict).toBe('review')
    expect(r.score).toBe(25 + 25 + 15 + 10) // 75
    expect(r.reasons.length).toBe(4)
  })

  it('unknown age adds a small penalty', () => {
    expect(computeRisk({ ...base, poolAgeDays: null }).score).toBe(8)
  })

  it('clamps at 100 and never negative', () => {
    const r = computeRisk({ ...base, tvlUsd: 1, poolAgeDays: 0, volTvlRatio: 999, txCount24: 0 })
    expect(r.score).toBeLessThanOrEqual(100)
    expect(r.score).toBeGreaterThanOrEqual(0)
  })

  it('never certifies safety — verdict is at most "review" for eligible pools', () => {
    const verdicts = [base, { ...base, tvlUsd: 10_000 }].map((s) => computeRisk(s).verdict)
    expect(verdicts.every((v) => v === 'review')).toBe(true)
  })
})

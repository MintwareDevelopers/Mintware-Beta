import { describe, it, expect } from 'vitest'
import { computeRisk, normalizeSignals, SIGNAL_BOUNDS, type PoolSignals } from './riskScore'

const base: PoolSignals = {
  protocol: 'v4',
  usdgQuoted: true,
  poolAgeDays: 30,
  tvlUsd: 8_100_000,
  vol24Usd: 29_700_000,
  volTvlRatio: 3.7,
  txCount24: 5000,
  feePct: 0.3,
  tokensResolved: true,
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
  it('ineligible (FAIL-CLOSED): quote asset unknown (LP_GATEWAY_USDG unset) — never inferred from a name', () => {
    const r = computeRisk({ ...base, usdgQuoted: null })
    expect(r.verdict).toBe('ineligible')
    expect(r.score).toBe(100)
    expect(r.reasons[0]).toMatch(/LP_GATEWAY_USDG unset/)
  })

  it('a deep, established USDG v4 pool scores low but still routes to review', () => {
    const r = computeRisk(base)
    expect(r.verdict).toBe('review') // NEVER auto-approve on cheap signals
    expect(r.score).toBe(0)
  })

  it('penalizes thin TVL + very new + wash-y vol/TVL + low tx', () => {
    const r = computeRisk({ ...base, tvlUsd: 20_000, vol24Usd: 800_000, poolAgeDays: 1, volTvlRatio: 40, txCount24: 5 })
    expect(r.verdict).toBe('review')
    expect(r.score).toBe(25 + 25 + 15 + 10) // 75
    expect(r.reasons.length).toBe(4)
  })

  it('unknown age adds a small penalty', () => {
    expect(computeRisk({ ...base, poolAgeDays: null }).score).toBe(8)
  })

  it('an unusual fee tier (>3%) and unresolved token legs each add a penalty (O-7: numeric/enum signals only)', () => {
    expect(computeRisk({ ...base, feePct: 5 }).score).toBe(10)
    expect(computeRisk({ ...base, feePct: 5 }).reasons).toContain('unusual fee tier (>3%)')
    expect(computeRisk({ ...base, tokensResolved: false }).score).toBe(10)
    expect(computeRisk({ ...base, feePct: null }).score).toBe(0) // unknown tier = no APR, no penalty
  })

  it('clamps at 100 and never negative', () => {
    const r = computeRisk({ ...base, tvlUsd: 1, poolAgeDays: 0, volTvlRatio: 999, txCount24: 0, feePct: 9, tokensResolved: false })
    expect(r.score).toBeLessThanOrEqual(100)
    expect(r.score).toBeGreaterThanOrEqual(0)
  })

  it('never certifies safety — verdict is at most "review" for eligible pools', () => {
    const verdicts = [base, { ...base, tvlUsd: 10_000 }].map((s) => computeRisk(s).verdict)
    expect(verdicts.every((v) => v === 'review')).toBe(true)
  })
})

// O-7: the scorer only ever sees CLAMPED numerics — hostile values land in the same buckets a real pool can.
describe('normalizeSignals — every numeric input is bounded', () => {
  it('coerces NaN / Infinity / negative / absurd values into the bound', () => {
    const n = normalizeSignals({
      ...base,
      tvlUsd: Number.POSITIVE_INFINITY,
      vol24Usd: -5,
      poolAgeDays: 1e9,
      volTvlRatio: Number.NaN,
      txCount24: -1,
      feePct: 99,
    })
    expect(n.tvlUsd).toBe(SIGNAL_BOUNDS.tvlUsd.max)
    expect(n.vol24Usd).toBe(0)
    expect(n.poolAgeDays).toBe(SIGNAL_BOUNDS.poolAgeDays.max)
    expect(n.volTvlRatio).toBe(0) // recomputed from the clamped legs (0 / max)
    expect(n.txCount24).toBe(0)
    expect(n.feePct).toBe(SIGNAL_BOUNDS.feePct.max)
  })
  it('NaN tvl coerces to the min edge; a garbage protocol → unknown; a garbage quote flag → null (unknown)', () => {
    const n = normalizeSignals({ ...base, tvlUsd: Number.NaN, protocol: 'lol' as never, usdgQuoted: 'yes' as never })
    expect(n.tvlUsd).toBe(0)
    expect(n.protocol).toBe('unknown')
    expect(n.usdgQuoted).toBeNull()
    expect(computeRisk(n).verdict).toBe('ineligible')
  })
  it('a 1e300 volume with $1 TVL cannot exceed the ratio bound (no Infinity, no NaN in reasons)', () => {
    const r = computeRisk({ ...base, tvlUsd: 1, vol24Usd: 1e300 })
    expect(Number.isFinite(r.score)).toBe(true)
    expect(r.reasons).toContain('very high vol/TVL — possible wash trading')
  })
})

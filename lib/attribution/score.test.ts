// =============================================================================
// Attribution Engine v2 — golden-wallet tests.
//
// These lock the redesign's THESIS in place: a genuine long-term LP outranks a
// referral farmer, a dump-whale, and a risk-flagged trader. The legacy
// Sharing=400 weighting failed exactly this — a farmer could out-score an LP.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { computeScore } from './score'
import { MAX_SCORE } from './types'
import {
  NOW_MS, GOLDEN_LONG_TERM_LP, GOLDEN_REFERRAL_FARMER, GOLDEN_DUMP_WHALE,
  GOLDEN_SANCTIONED, GOLDEN_NEWCOMER,
} from './mockProvider'

const score = (a: Parameters<typeof computeScore>[0]) => computeScore(a, NOW_MS)

const lp = score(GOLDEN_LONG_TERM_LP)
const farmer = score(GOLDEN_REFERRAL_FARMER)
const whale = score(GOLDEN_DUMP_WHALE)
const sanctioned = score(GOLDEN_SANCTIONED)
const newcomer = score(GOLDEN_NEWCOMER)

const sig = (r: ReturnType<typeof score>, key: string) =>
  r.signals.find(s => s.key === key)!

describe('engine invariants', () => {
  const all = [lp, farmer, whale, sanctioned, newcomer]

  it('every score is within [0, MAX_SCORE]', () => {
    for (const r of all) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(MAX_SCORE)
    }
  })

  it('no positive signal exceeds its own max', () => {
    for (const r of all) {
      for (const s of r.signals) {
        if (s.key === 'risk') continue
        expect(s.score).toBeLessThanOrEqual(s.max)
        expect(s.score).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('score = clamp(rawScore - riskPenalty)', () => {
    for (const r of all) {
      expect(r.score).toBe(Math.max(0, Math.min(MAX_SCORE, r.rawScore - r.riskPenalty)))
    }
  })

  it('is deterministic for a fixed nowMs', () => {
    expect(score(GOLDEN_LONG_TERM_LP)).toEqual(lp)
  })

  it('every signal carries at least one insight (explainability)', () => {
    for (const s of lp.signals) expect(s.insights.length).toBeGreaterThan(0)
  })
})

describe('THE HEADLINE: a genuine LP beats a referral farmer', () => {
  it('LP ranks far above the farmer', () => {
    expect(lp.score).toBeGreaterThan(farmer.score)
    expect(lp.score - farmer.score).toBeGreaterThan(400)
  })

  it('the farmer scores low despite 140 referrals (Network capped at 100, low quality + sybil risk)', () => {
    expect(sig(farmer, 'network').max).toBe(100)
    expect(farmer.score).toBeLessThan(80)
    expect(farmer.riskPenalty).toBeGreaterThan(0)
  })
})

describe('LP archetype', () => {
  it('is gold tier with a strong, broad score', () => {
    expect(lp.score).toBeGreaterThan(600)
    expect(lp.tier).toBe('gold')
  })
  it('leads on liquidity + holding (the intended core signals)', () => {
    expect(sig(lp, 'liquidity').score).toBeGreaterThan(120)
    expect(sig(lp, 'holding').score).toBeGreaterThan(120)
    expect(sig(lp, 'longevity').score).toBeGreaterThan(80)
  })
})

describe('dump-whale archetype', () => {
  it('maxes Volume but scores modestly overall (no conviction, no history)', () => {
    expect(sig(whale, 'volume').score).toBeGreaterThan(90)
    expect(sig(whale, 'holding').score).toBeLessThan(20)
    expect(sig(whale, 'longevity').score).toBeLessThan(20)
    expect(whale.score).toBeLessThan(300)
    expect(whale.score).toBeGreaterThan(farmer.score)
  })
})

describe('risk deduction turns a tally into a reputation', () => {
  it('the sanctioned wallet is capped-penalized and dropped well below its raw score', () => {
    expect(sanctioned.riskPenalty).toBe(200) // sanctioned 0.9×200 + mixer 0.6×120, capped at RISK_MAX
    expect(sanctioned.rawScore).toBeGreaterThan(300)
    expect(sanctioned.score).toBeLessThan(sanctioned.rawScore - 150)
  })
  it('the same activity without flags would have earned a much higher score', () => {
    const clean = score({ ...GOLDEN_SANCTIONED, riskFlags: [] })
    expect(clean.score).toBeGreaterThan(sanctioned.score + 150)
  })
})

describe('newcomer archetype', () => {
  it('scores near-zero and bronze', () => {
    expect(newcomer.score).toBeLessThan(60)
    expect(newcomer.tier).toBe('bronze')
  })
})

describe('the full ranking is defensible', () => {
  it('LP > sanctioned(raw) > whale > farmer ≈ newcomer, with LP on top after risk', () => {
    expect(lp.score).toBeGreaterThan(whale.score)
    expect(lp.score).toBeGreaterThan(sanctioned.score)
    expect(whale.score).toBeGreaterThan(farmer.score)
  })
})

// The anti-gaming property the calibration research calls non-negotiable and
// CI-enforceable: the score is MONOTONE — more good behavior never lowers it,
// and a risk flag never raises it. A monotone score can't be gamed by *reducing*
// a positive signal, and every reason code has a guaranteed sign.
describe('monotonicity invariant (anti-gaming, CI-enforced)', () => {
  const base = GOLDEN_DUMP_WHALE // mid-range, headroom to move in every signal

  it('increasing any positive input never lowers the score', () => {
    const b = score(base).score
    expect(score({ ...base, lifetimeVolumeUsd: base.lifetimeVolumeUsd * 3 }).score).toBeGreaterThanOrEqual(b)
    expect(score({ ...base, activeWeeks: base.activeWeeks + 20 }).score).toBeGreaterThanOrEqual(b)
    expect(score({ ...base, chains: [...base.chains, 'base', 'arbitrum'] }).score).toBeGreaterThanOrEqual(b)
    expect(score({ ...base, positions: [...base.positions, { symbol: 'ETH', usdValue: 20_000, holdDays: 300 }] }).score).toBeGreaterThanOrEqual(b)
    expect(score({ ...base, lpPositions: [{ pool: 'ETH/USDC', usdDepth: 30_000, durationDays: 200, active: true }] }).score).toBeGreaterThanOrEqual(b)
    expect(score({ ...base, govVotes: base.govVotes + 15 }).score).toBeGreaterThanOrEqual(b)
  })

  it('adding a risk flag never raises the score', () => {
    const b = score(base).score
    expect(score({ ...base, riskFlags: [{ type: 'scam', severity: 0.5 }] }).score).toBeLessThanOrEqual(b)
  })
})

describe('reason codes (topDrivers)', () => {
  it('never exceeds 4 and LP surfaces a strength', () => {
    expect(lp.topDrivers.length).toBeLessThanOrEqual(4)
    expect(lp.topDrivers.some(d => d.direction === 'strength')).toBe(true)
  })
  it('a risk-penalized wallet leads with the risk adverse factor', () => {
    expect(sanctioned.topDrivers[0].key).toBe('risk')
    expect(sanctioned.topDrivers[0].direction).toBe('weakness')
  })
})

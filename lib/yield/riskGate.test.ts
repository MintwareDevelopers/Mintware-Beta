import { describe, it, expect } from 'vitest'
import { computeRiskGatedWeights, type VenueRisk } from './riskGate'
import { type VenueRate } from './rateRouter'

const V = (key: string, apyBps: number): VenueRate => ({ key, apyBps, available: true })

// A realistic set: an exotic venue paying the most, two blue-chips paying less.
const VENUES: VenueRate[] = [V('exotic', 1200), V('aave', 480), V('morpho', 550)]
const allOk: Record<string, VenueRisk> = { exotic: { level: 'ok' }, aave: { level: 'ok' }, morpho: { level: 'ok' } }

describe('computeRiskGatedWeights — the circuit breaker', () => {
  it('with all-ok signals, matches the v0 best-rate allocation', () => {
    const { weights, halted, throttled } = computeRiskGatedWeights(VENUES, allOk, { maxVenueBps: 4000 })
    expect(halted).toEqual([])
    expect(throttled).toEqual([])
    // ranked exotic(12%),morpho(5.5%),aave(4.8%) → 40/40/20
    expect(weights).toEqual([
      { key: 'exotic', weightBps: 4000 },
      { key: 'morpho', weightBps: 4000 },
      { key: 'aave', weightBps: 2000 },
    ])
  })

  it('HALT deallocates the venue even when it pays the MOST (the rsETH defense)', () => {
    // The exotic top-payer is flagged — a rate-follower would keep pouring in; the gate excludes it.
    const risk: Record<string, VenueRisk> = { ...allOk, exotic: { level: 'halt', reason: 'collateral depeg' } }
    const { weights, halted } = computeRiskGatedWeights(VENUES, risk, { maxVenueBps: 4000 })
    expect(halted).toEqual([{ key: 'exotic', reason: 'collateral depeg' }])
    expect(weights.find((w) => w.key === 'exotic')).toBeUndefined() // weight forced to 0
    // capital flows to the survivors, best-rate first: morpho 40%, aave 40% (remaining budget)
    expect(weights).toEqual([
      { key: 'morpho', weightBps: 4000 },
      { key: 'aave', weightBps: 4000 },
    ])
  })

  it('ELEVATED throttles a venue to the tighter cap instead of excluding it', () => {
    const risk: Record<string, VenueRisk> = { ...allOk, exotic: { level: 'elevated', reason: 'TVL outflow' } }
    const { weights, throttled } = computeRiskGatedWeights(VENUES, risk, { maxVenueBps: 4000, elevatedMaxVenueBps: 1000 })
    expect(throttled).toEqual([{ key: 'exotic', reason: 'TVL outflow', capBps: 1000 }])
    // exotic still ranks first but is capped at 10%; morpho + aave take the rest.
    expect(weights).toEqual([
      { key: 'exotic', weightBps: 1000 },
      { key: 'morpho', weightBps: 4000 },
      { key: 'aave', weightBps: 4000 },
    ])
  })

  it('a MISSING risk signal fails CLOSED (treated as halt) by default', () => {
    const risk: Record<string, VenueRisk> = { aave: { level: 'ok' }, morpho: { level: 'ok' } } // exotic missing
    const { weights, halted } = computeRiskGatedWeights(VENUES, risk, { maxVenueBps: 4000 })
    expect(halted).toEqual([{ key: 'exotic', reason: 'no risk signal (fail-closed)' }])
    expect(weights.find((w) => w.key === 'exotic')).toBeUndefined()
  })

  it('haltOnMissing:false treats a missing signal as ok (yield over safety — opt-in)', () => {
    const risk: Record<string, VenueRisk> = { aave: { level: 'ok' }, morpho: { level: 'ok' } }
    const { weights, halted } = computeRiskGatedWeights(VENUES, risk, { maxVenueBps: 4000, haltOnMissing: false })
    expect(halted).toEqual([])
    expect(weights[0]).toEqual({ key: 'exotic', weightBps: 4000 })
  })

  it('halting EVERY venue yields an empty allocation (all capital stays idle/safe)', () => {
    const risk: Record<string, VenueRisk> = { exotic: { level: 'halt' }, aave: { level: 'halt' }, morpho: { level: 'halt' } }
    const { weights, halted } = computeRiskGatedWeights(VENUES, risk, { maxVenueBps: 4000 })
    expect(weights).toEqual([])
    expect(halted).toHaveLength(3)
  })

  it('respects the v0 idle buffer + never exceeds 100% after gating', () => {
    const { weights } = computeRiskGatedWeights(VENUES, allOk, { maxVenueBps: 4000, idleBufferBps: 2000 })
    const total = weights.reduce((s, w) => s + w.weightBps, 0)
    expect(total).toBeLessThanOrEqual(8000) // budget = 10000 - 2000
  })
})

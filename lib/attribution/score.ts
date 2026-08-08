// =============================================================================
// Attribution Engine v2 — orchestrator.
//
// computeScore(activity, nowMs) runs all seven positive signals, subtracts the
// risk penalty, and derives tier + percentile. Pure and deterministic: same
// input + same `nowMs` → same output (so it's snapshot-testable). `nowMs` is a
// parameter, never Date.now() inside, for that reason.
// =============================================================================

import type { WalletActivity, ScoreResult, SignalResult, ScoreDriver, Tier, RiskFlag } from './types'
import { MAX_SCORE, ENGINE_VERSION } from './types'
import { clamp01, round } from './normalize'
import {
  liquiditySignal, holdingSignal, activitySignal, longevitySignal,
  volumeSignal, governanceSignal, networkSignal, riskPenalty,
} from './signals'

function tierFor(score: number): Tier {
  if (score >= 617) return 'gold'   // ≥ ⅔ of MAX_SCORE
  if (score >= 308) return 'silver' // ≥ ⅓ of MAX_SCORE
  return 'bronze'
}

// v2.0 calibrated estimate. The distribution is intentionally skewed (70% of the
// weight sits in behaviors most wallets never do), so we map score→percentile
// with a concave curve rather than linearly. Replaced by a true population
// percentile in v2.1 (see `percentileScore` in normalize.ts).
function percentileFor(score: number): number {
  return round(100 * clamp01(Math.pow(score / MAX_SCORE, 0.7)))
}

// FICO/FCRA-style reason codes: the ≤4 key factors moving the score. Risk (the
// material adverse factor) leads, then the biggest opportunities, then the top
// strength — so a wallet always sees what's holding it back AND what it's earned.
function deriveDrivers(positive: SignalResult[], riskPenalty: number, flags: RiskFlag[]): ScoreDriver[] {
  const fill = (s: SignalResult) => (s.max > 0 ? s.score / s.max : 0)
  const weaknesses = [...positive]
    .filter(s => fill(s) < 0.5)
    .sort((a, b) => (b.max - b.score) - (a.max - a.score))
    .slice(0, 2)
    .map<ScoreDriver>(s => ({ key: s.key, name: s.name, direction: 'weakness', detail: `${s.name} is your biggest opportunity — ${s.score}/${s.max}` }))
  const strength = [...positive]
    .filter(s => fill(s) >= 0.55)
    .sort((a, b) => fill(b) - fill(a))
    .slice(0, 1)
    .map<ScoreDriver>(s => ({ key: s.key, name: s.name, direction: 'strength', detail: `${s.name} is a strength — ${s.score}/${s.max}` }))

  const drivers: ScoreDriver[] = []
  if (riskPenalty > 0) {
    drivers.push({
      key: 'risk', name: 'Risk', direction: 'weakness',
      detail: `risk flags cut ${riskPenalty} points — ${flags.map(f => f.type.replace('_', ' ')).join(', ')}`,
    })
  }
  drivers.push(...weaknesses, ...strength)
  return drivers.slice(0, 4)
}

export function computeScore(activity: WalletActivity, nowMs: number): ScoreResult {
  const signals: SignalResult[] = [
    liquiditySignal(activity),
    holdingSignal(activity),
    activitySignal(activity),
    longevitySignal(activity, nowMs),
    volumeSignal(activity),
    networkSignal(activity),
    governanceSignal(activity),
  ]

  const rawScore = Math.min(MAX_SCORE, signals.reduce((s, sig) => s + sig.score, 0))
  const risk = riskPenalty(activity.riskFlags)
  const score = Math.max(0, Math.min(MAX_SCORE, rawScore - risk.penalty))

  // Surface risk as a pseudo-signal too (negative), so UIs that render the
  // signal list can show WHY a score was docked without special-casing.
  const riskSignal: SignalResult = {
    key: 'risk', name: 'Risk', icon: '⚠', color: '#ef4444',
    max: 0, score: -risk.penalty, insights: risk.insights,
  }

  return {
    address: activity.address,
    score,
    rawScore,
    riskPenalty: risk.penalty,
    tier: tierFor(score),
    percentile: percentileFor(score),
    signals: [...signals, riskSignal],
    topDrivers: deriveDrivers(signals, risk.penalty, activity.riskFlags),
    risk: { penalty: risk.penalty, flags: activity.riskFlags },
    version: ENGINE_VERSION,
  }
}

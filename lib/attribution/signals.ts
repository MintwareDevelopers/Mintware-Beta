// =============================================================================
// Attribution Engine v2 — the eight signals.
//
// Each positive signal is a pure function (activity[, nowMs]) → SignalResult,
// normalized to 0..1 then scaled by its weight. Risk is a separate DEDUCTION.
// Every signal emits `insights` so the score is explainable, never "trust me".
// =============================================================================

import type { WalletActivity, SignalResult, RiskFlag, RiskType } from './types'
import { WEIGHTS, RISK_MAX } from './types'
import { logCurve, linearCap, recencyDecay, clamp01, round } from './normalize'

const DAY_MS = 86_400_000

function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${Math.round(n)}`
}

// ── Liquidity (200) — real LP depth × duration; the core DeFi contribution ────
export function liquiditySignal(a: WalletActivity): SignalResult {
  const depthDuration = a.lpPositions.reduce(
    (s, lp) => s + lp.usdDepth * clamp01(lp.durationDays / 180),
    0,
  )
  const activeCount = a.lpPositions.filter(lp => lp.active).length
  const raw = logCurve(depthDuration, 20_000)
  return {
    key: 'liquidity', name: 'Liquidity', icon: '⬡', color: '#C27A00',
    max: WEIGHTS.liquidity, score: round(raw * WEIGHTS.liquidity),
    insights: [
      { label: 'Depth × duration', detail: `${usd(depthDuration)} of committed, time-weighted liquidity` },
      { label: 'Positions', detail: `${a.lpPositions.length} LP position${a.lpPositions.length === 1 ? '' : 's'} · ${activeCount} still open` },
    ],
  }
}

// ── Holding (150) — conviction: value kept, weighted by how long ──────────────
export function holdingSignal(a: WalletActivity): SignalResult {
  const conviction = a.positions.reduce(
    (s, p) => s + p.usdValue * clamp01(p.holdDays / 180),
    0,
  )
  const longHeld = a.positions.filter(p => p.holdDays >= 90).length
  const raw = logCurve(conviction, 15_000)
  return {
    key: 'holding', name: 'Holding', icon: '◆', color: '#2A9E8A',
    max: WEIGHTS.holding, score: round(raw * WEIGHTS.holding),
    insights: [
      { label: 'Conviction', detail: `${usd(conviction)} held, weighted by duration` },
      { label: 'Long-term', detail: `${longHeld} position${longHeld === 1 ? '' : 's'} held over 90 days` },
    ],
  }
}

// ── Activity & Sophistication (150) — consistency + breadth, not bursts ───────
export function activitySignal(a: WalletActivity): SignalResult {
  const consistency = logCurve(a.activeWeeks, 26)        // ~26 active weeks ≈ 0.5
  const breadth = linearCap(a.chains.length, 6)          // 6 chains ≈ full breadth
  const depth = logCurve(a.totalTxCount, 200)
  const raw = 0.45 * consistency + 0.3 * breadth + 0.25 * depth
  return {
    key: 'activity', name: 'Activity', icon: '◈', color: '#6B8FFF',
    max: WEIGHTS.activity, score: round(raw * WEIGHTS.activity),
    insights: [
      { label: 'Consistency', detail: `active in ${a.activeWeeks} distinct weeks` },
      { label: 'Breadth', detail: `${a.chains.length} chain${a.chains.length === 1 ? '' : 's'} · ${a.totalTxCount} txs` },
    ],
  }
}

// ── Longevity (150) — age + tenure + recency; the strongest anti-sybil ────────
export function longevitySignal(a: WalletActivity, nowMs: number): SignalResult {
  const ageDays = a.firstSeenMs > 0 ? Math.max(0, (nowMs - a.firstSeenMs) / DAY_MS) : 0
  const ageScore = logCurve(ageDays, 730)                     // 2 years ≈ 0.5
  const totalWeeks = Math.max(1, ageDays / 7)
  const tenure = clamp01(a.activeWeeks / totalWeeks)          // fraction of its life it's been active
  const recency = recencyDecay(a.lastSeenMs, nowMs, 180)
  // Age GATES tenure + recency multiplicatively: a 1-day wallet is trivially
  // "100% active + just seen", so those only count once real age exists.
  const raw = ageScore * (0.6 + 0.4 * (0.5 * tenure + 0.5 * recency))
  const years = (ageDays / 365).toFixed(1)
  return {
    key: 'longevity', name: 'Longevity', icon: '◷', color: '#4f7ef7',
    max: WEIGHTS.longevity, score: round(raw * WEIGHTS.longevity),
    insights: [
      { label: 'Age', detail: ageDays > 0 ? `${years} years on-chain` : 'new wallet' },
      { label: 'Tenure', detail: `active in ${Math.round(tenure * 100)}% of its lifetime` },
    ],
  }
}

// ── Volume (100) — log-normalized so it's sophistication, not whale size ──────
export function volumeSignal(a: WalletActivity): SignalResult {
  const raw = logCurve(a.lifetimeVolumeUsd, 100_000)
  return {
    key: 'volume', name: 'Volume', icon: '⇄', color: '#3A52CC',
    max: WEIGHTS.volume, score: round(raw * WEIGHTS.volume),
    insights: [
      { label: 'Lifetime volume', detail: `${usd(a.lifetimeVolumeUsd)} traded (log-scaled)` },
    ],
  }
}

// ── Governance & Contribution (75) — kept modest; most wallets score low ──────
export function governanceSignal(a: WalletActivity): SignalResult {
  const weighted = a.govVotes + a.govProposals * 3 + a.delegations * 2
  const raw = logCurve(weighted, 15)
  return {
    key: 'governance', name: 'Governance', icon: '⊕', color: '#7B6FCC',
    max: WEIGHTS.governance, score: round(raw * WEIGHTS.governance),
    insights: [
      { label: 'Participation', detail: `${a.govVotes} votes · ${a.govProposals} proposals · ${a.delegations} delegations` },
    ],
  }
}

// ── Network (100) — referral tree QUALITY, not count (down from legacy 400) ───
export function networkSignal(a: WalletActivity): SignalResult {
  const qualitySum = a.referrals.reduce(
    (s, r) => s + r.referredScore * (r.retained ? 1 : 0.5),
    0,
  )
  const avg = a.referrals.length ? Math.round(qualitySum / a.referrals.length) : 0
  const raw = logCurve(qualitySum, 1200)
  return {
    key: 'network', name: 'Network', icon: '◉', color: '#C2537A',
    max: WEIGHTS.network, score: round(raw * WEIGHTS.network),
    insights: [
      { label: 'Referral quality', detail: `${a.referrals.length} referred · avg score ${avg} (quality-weighted)` },
    ],
  }
}

// ── Risk (deduction, up to −RISK_MAX) — turns a tally into a reputation ───────
const RISK_WEIGHT: Record<RiskType, number> = {
  sanctioned: 200,
  mixer: 120,
  scam: 100,
  sybil_cluster: 100,
  wash_trading: 80,
}

export function riskPenalty(flags: RiskFlag[]): {
  penalty: number
  insights: { label: string; detail: string }[]
} {
  const raw = flags.reduce((s, f) => s + clamp01(f.severity) * RISK_WEIGHT[f.type], 0)
  const penalty = Math.min(RISK_MAX, round(raw))
  const insights = flags.length
    ? flags.map(f => ({ label: 'Flag', detail: `${f.type.replace('_', ' ')} (severity ${(f.severity * 100).toFixed(0)}%)` }))
    : [{ label: 'Clean', detail: 'no sanctioned / mixer / wash / sybil signals detected' }]
  return { penalty, insights }
}

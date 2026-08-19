// =============================================================================
// Attribution Engine v2 — legacy `/score` compat adapter (the cutover seam).
//
// Maps a v2 ScoreResult + WalletActivity into the shape the existing app UI
// consumes (the old external worker's `/score` response), so consumers can point
// at v2 without a rewrite. Everything here is DERIVED FROM REAL DATA — nothing is
// fabricated. Fields the old worker invented that v2 doesn't compute
// (`uvOpportunities`, `timeline`, the earnings `totalLo/totalHi` $/yr range) are
// returned empty/zero so the UI degrades gracefully rather than showing made-up
// numbers.
// =============================================================================

import type { ScoreResult, WalletActivity, Tier } from './types'

export interface LegacyScore {
  score: number
  tier: Tier
  percentile: number
  walletAge: string
  firstSeen: string
  chains: number
  totalTxCount: number
  treeSize: number
  treeQuality: string
  totalLo: number
  totalHi: number
  signals: { key: string; name: string; icon: string; max: number; color: string; score: number; insights: unknown[] }[]
  character: { label: string; color: string; desc: string; icon: string }
  uvOpportunities: unknown[]
  timeline: unknown[]
  projects: { name: string; symbol: string; cat: string; deployed: number }[]
  // v2 extras carried through so new UI can use them; old UI ignores them.
  percentileBasis: 'estimate' | 'population'
  source?: string
  /** v2's Risk deduction (≥0, already applied to `score`) — the risk
   *  pseudo-signal is filtered out of `signals` below (legacy UI expects
   *  positive signals only), so this is its only surfaced form. */
  riskPenalty: number
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function ageString(firstSeenMs: number, nowMs: number): string {
  if (!firstSeenMs || firstSeenMs >= nowMs) return 'new'
  const days = (nowMs - firstSeenMs) / 86_400_000
  if (days < 60) return `${Math.max(1, Math.round(days))} days`
  const months = Math.round(days / 30)
  if (months < 24) return `${months} months`
  return `${(days / 365).toFixed(1)} years`
}

function firstSeenString(firstSeenMs: number): string {
  if (!firstSeenMs) return '—'
  const d = new Date(firstSeenMs)
  return `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// Character derived from tier — a recognizable label, not a fabricated stat.
const CHARACTER: Record<Tier, { label: string; color: string; icon: string; desc: string }> = {
  gold: { label: 'Oracle', color: '#C27A00', icon: '◆', desc: 'Deep, sustained on-chain contribution.' },
  silver: { label: 'Builder', color: '#4f7ef7', icon: '⬡', desc: 'A real, active on-chain presence.' },
  bronze: { label: 'Ghost', color: '#8A8C9E', icon: '○', desc: 'Early or light on-chain footprint.' },
}

export function toLegacyScore(result: ScoreResult, activity: WalletActivity, nowMs: number): LegacyScore {
  const referred = activity.referrals
  const treeQualityNum = referred.length
    ? referred.reduce((s, r) => s + r.referredScore, 0) / referred.length / 925
    : 0

  return {
    score: result.score,
    tier: result.tier,
    percentile: result.percentile,
    walletAge: ageString(activity.firstSeenMs, nowMs),
    firstSeen: firstSeenString(activity.firstSeenMs),
    chains: activity.chains.length,
    totalTxCount: activity.totalTxCount,
    treeSize: referred.length,
    treeQuality: treeQualityNum.toFixed(2),
    totalLo: 0, // old worker's invented earnings range — intentionally not fabricated
    totalHi: 0,
    signals: result.signals
      .filter(s => s.key !== 'risk') // legacy UI expects positive signals only
      .map(s => ({ key: s.key, name: s.name, icon: s.icon, max: s.max, color: s.color, score: s.score, insights: s.insights })),
    character: CHARACTER[result.tier],
    uvOpportunities: [], // not computed by v2 → UI hides the section
    timeline: [],        // no score history yet → UI hides the sparkline
    projects: activity.positions
      .slice()
      .sort((a, b) => b.usdValue - a.usdValue)
      .slice(0, 12)
      .map(p => ({ name: p.symbol, symbol: p.symbol, cat: 'Token', deployed: Math.round(p.usdValue) })),
    percentileBasis: result.percentileBasis,
    riskPenalty: result.risk.penalty,
  }
}

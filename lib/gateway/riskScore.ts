// Pure risk scoring for auto-surfaced pool candidates. IMPORTANT: this scores only the CHEAP signals
// (protocol, quote asset, age, TVL, vol/TVL, tx count). It does NOT run a honeypot sim, a hostile-hook
// check, or token-contract verification — so a LOW score never means "safe", only "clears the cheap
// signals". The verdict is therefore never "auto-approve" in phase-1: every eligible candidate routes to
// HUMAN review; the score just ranks the queue so the curator looks at the least-suspect first.

export type PoolSignals = {
  protocol: 'v2' | 'v3' | 'v4' | 'unknown'
  usdgQuoted: boolean
  poolAgeDays: number | null
  tvlUsd: number
  vol24Usd: number
  volTvlRatio: number | null
  txCount24: number | null
}

export type RiskVerdict = 'ineligible' | 'review'

export function computeRisk(s: PoolSignals): { score: number; verdict: RiskVerdict; reasons: string[] } {
  const reasons: string[] = []

  // Hard ineligibility — the gateway can only LP into a v4, USDG-quoted pool.
  if (s.protocol !== 'v4') {
    return { score: 100, verdict: 'ineligible', reasons: ['not a Uniswap v4 pool (gateway is v4-only)'] }
  }
  if (!s.usdgQuoted) {
    return { score: 100, verdict: 'ineligible', reasons: ['not USDG-quoted'] }
  }

  let score = 0
  if (s.tvlUsd < 50_000) {
    score += 25
    reasons.push('thin TVL (<$50k)')
  } else if (s.tvlUsd < 150_000) {
    score += 10
    reasons.push('modest TVL')
  }
  if (s.poolAgeDays == null) {
    score += 8
    reasons.push('unknown age')
  } else if (s.poolAgeDays < 3) {
    score += 25
    reasons.push('very new (<3d) — rug window')
  } else if (s.poolAgeDays < 7) {
    score += 12
    reasons.push('new (<7d)')
  }
  if (s.volTvlRatio != null && s.volTvlRatio > 25) {
    score += 15
    reasons.push('very high vol/TVL — possible wash trading')
  }
  if (s.txCount24 != null && s.txCount24 < 20) {
    score += 10
    reasons.push('low 24h tx count')
  }

  score = Math.max(0, Math.min(100, score))
  // ALWAYS human review in phase-1 — the cheap score never certifies safety (no honeypot/hook check).
  return { score, verdict: 'review', reasons }
}

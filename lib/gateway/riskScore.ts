// Pure risk scoring for auto-surfaced pool candidates. IMPORTANT: this scores only the CHEAP signals
// (protocol, quote asset, age, TVL, vol/TVL, tx count, fee tier, token-leg resolution). It does NOT run
// a honeypot sim, a hostile-hook check, or token-contract verification — so a LOW score never means
// "safe", only "clears the cheap signals". The verdict is therefore never "auto-approve" in phase-1:
// every eligible candidate routes to HUMAN review; the score just ranks the queue so the curator looks
// at the least-suspect first.
//
// Round-2 audit O-7 (R-4): the scorer must not be steerable by upstream-controlled FREE TEXT. Every
// input here is numeric or a bounded enum — pool name / symbol / URLs / images never reach this file —
// and every numeric input is clamped to a sane range (`normalizeSignals`) before it is compared, so a
// hostile payload (NaN, negative, 1e300, …) can only ever land in the same buckets a real pool can.
// Residual (honest): the NUMBERS themselves are upstream-asserted (GeckoTerminal), not on-chain-verified,
// so a wash-traded fake pool can still report "perfect" metrics. That is exactly why the verdict is
// never better than 'review' and the UI must never present the score as certification.

export type PoolSignals = {
  protocol: 'v2' | 'v3' | 'v4' | 'unknown'
  /** true / false when matched by ADDRESS against `LP_GATEWAY_USDG`; `null` = quote asset UNKNOWN
   *  (env unset) — never inferred from the pair name (O-7). */
  usdgQuoted: boolean | null
  poolAgeDays: number | null
  tvlUsd: number
  vol24Usd: number
  volTvlRatio: number | null
  txCount24: number | null
  /** Fee tier in percent (e.g. 0.3), bounded ≤ MAX_FEE_PCT by discovery; null when unknown. */
  feePct?: number | null
  /** Both token legs resolved to a 20-byte address (a well-formed 2-token pool). */
  tokensResolved?: boolean
}

export type RiskVerdict = 'ineligible' | 'review'

// ── Bounds (one home). Anything outside is clamped, never trusted. ──────────────────────────────────
export const SIGNAL_BOUNDS = {
  tvlUsd: { min: 0, max: 1e12 },
  vol24Usd: { min: 0, max: 1e12 },
  poolAgeDays: { min: 0, max: 36_500 },
  volTvlRatio: { min: 0, max: 1e6 },
  txCount24: { min: 0, max: 1e8 },
  feePct: { min: 0, max: 10 }, // > 10% fee tier is not a real market — treated as unknown upstream
} as const

/** NaN ⇒ min edge; ±Infinity ⇒ the matching edge; else clamped into [min, max]. */
function clamp(v: unknown, b: { min: number; max: number }): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (Number.isNaN(n)) return b.min
  return Math.min(b.max, Math.max(b.min, n))
}

function clampNullable(v: unknown, b: { min: number; max: number }): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(n) ? null : Math.min(b.max, Math.max(b.min, n))
}

/** Clamp every numeric signal into its bound; coerce garbage to the safe edge. Pure. */
export function normalizeSignals(s: PoolSignals): PoolSignals {
  const protocol: PoolSignals['protocol'] = s.protocol === 'v2' || s.protocol === 'v3' || s.protocol === 'v4' ? s.protocol : 'unknown'
  const tvlUsd = clamp(s.tvlUsd, SIGNAL_BOUNDS.tvlUsd)
  const vol24Usd = clamp(s.vol24Usd, SIGNAL_BOUNDS.vol24Usd)
  return {
    protocol,
    usdgQuoted: s.usdgQuoted === true ? true : s.usdgQuoted === false ? false : null,
    poolAgeDays: clampNullable(s.poolAgeDays, SIGNAL_BOUNDS.poolAgeDays),
    tvlUsd,
    vol24Usd,
    // recompute from the clamped legs when possible so the ratio can't disagree with them
    volTvlRatio: tvlUsd > 0 ? clamp(vol24Usd / tvlUsd, SIGNAL_BOUNDS.volTvlRatio) : clampNullable(s.volTvlRatio, SIGNAL_BOUNDS.volTvlRatio),
    txCount24: clampNullable(s.txCount24, SIGNAL_BOUNDS.txCount24),
    feePct: clampNullable(s.feePct, SIGNAL_BOUNDS.feePct),
    tokensResolved: s.tokensResolved !== false,
  }
}

export function computeRisk(input: PoolSignals): { score: number; verdict: RiskVerdict; reasons: string[] } {
  const s = normalizeSignals(input)
  const reasons: string[] = []

  // Hard ineligibility — the gateway can only LP into a v4, USDG-quoted pool.
  if (s.protocol !== 'v4') {
    return { score: 100, verdict: 'ineligible', reasons: ['not a Uniswap v4 pool (gateway is v4-only)'] }
  }
  if (s.usdgQuoted === null) {
    // Fail closed: with no configured USDG address we cannot know the quote asset, and we never infer it
    // from the pair name (O-7). Ops must set LP_GATEWAY_USDG for any pool to become eligible.
    return { score: 100, verdict: 'ineligible', reasons: ['quote asset unknown — LP_GATEWAY_USDG unset (fail-closed)'] }
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
  if (s.feePct != null && s.feePct > 3) {
    score += 10
    reasons.push('unusual fee tier (>3%)')
  }
  if (!s.tokensResolved) {
    score += 10
    reasons.push('token legs unresolved')
  }

  score = Math.max(0, Math.min(100, score))
  // ALWAYS human review in phase-1 — the cheap score never certifies safety (no honeypot/hook check).
  return { score, verdict: 'review', reasons }
}

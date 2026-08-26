// Card spend-buffer decision logic — the deterministic authorization check, the refill planner, and
// the refill-rate circuit breaker. Pure functions, integer/bigint atomic USDC (6dp).
// Spec: docs/developers/card-spend-buffer-spec.md §1, §5, §6.
//
// Why flat + deterministic: a Visa/Mastercard ASA authorization carries a hard ~6s window and cannot
// survive a live, multi-RPC, AMM-priced NAV computation — and that computed price is manipulable in
// the same block (§1). So on the CARD rail the approve/decline is a single flat read of the
// pre-funded buffer (this module), and a background loop keeps that buffer topped up from the vault,
// bounded by a rate cap that mirrors the edge-auth circuit breaker (services/edge-auth PortfolioGuard).
// (Agent-initiated x402 spend is a different rail with no such clock and keeps its live-NAV path — §8.)

export type BufferDeclineReason = 'over_per_tx_cap' | 'insufficient_buffer'

export interface BufferAuthDecision {
  approved: boolean
  reason?: BufferDeclineReason
}

/**
 * The flat, deterministic authorization check that runs INSIDE the ASA window (§1, §8). No NAV, no
 * RPC — just the pre-funded buffer balance and an optional per-transaction cap. A `perTxCapAtomic` of
 * `undefined` or `0n` means "no cap" (off = loosest), matching the timelock convention where 0 maps
 * to +∞. This is the single decision the ASA webhook responds with within Lithic's 6s cutoff.
 */
export function authorizeAgainstBuffer(
  amountAtomic: bigint,
  bufferBalanceAtomic: bigint,
  perTxCapAtomic?: bigint,
): BufferAuthDecision {
  if (amountAtomic <= 0n) return { approved: false, reason: 'insufficient_buffer' } // defensive: no zero/negative swipes
  if (perTxCapAtomic !== undefined && perTxCapAtomic > 0n && amountAtomic > perTxCapAtomic) {
    return { approved: false, reason: 'over_per_tx_cap' }
  }
  if (amountAtomic > bufferBalanceAtomic) return { approved: false, reason: 'insufficient_buffer' }
  return { approved: true }
}

export interface RefillPlanParams {
  /** Current flat buffer balance, atomic USDC. */
  bufferBalanceAtomic: bigint
  /** The "keep $X ready" target from bufferSizing.bufferTargetAtomic, atomic USDC. */
  targetAtomic: bigint
  /** Don't refill a trickle — avoid churning tiny vault redemptions (gas/thrash). Atomic USDC. Default 0. */
  minRefillAtomic?: bigint
}

export interface RefillPlan {
  shouldRefill: boolean
  /** How much to redeem from the vault and push into the buffer to reach target, atomic USDC. */
  refillAmountAtomic: bigint
}

/**
 * Plan a refill: top the buffer back up to `targetAtomic`. Refills only when the deficit clears the
 * `minRefillAtomic` threshold, so a nearly-full buffer doesn't trigger a churn of tiny redemptions.
 */
export function refillPlan(p: RefillPlanParams): RefillPlan {
  const deficit = p.targetAtomic - p.bufferBalanceAtomic
  if (deficit <= 0n) return { shouldRefill: false, refillAmountAtomic: 0n }
  const min = p.minRefillAtomic ?? 0n
  if (deficit < min) return { shouldRefill: false, refillAmountAtomic: 0n }
  return { shouldRefill: true, refillAmountAtomic: deficit }
}

export interface RefillRateState {
  /** Start of the current rolling window (unix secs). */
  windowStartSecs: number
  /** Total auto-refilled within the current window, atomic USDC. */
  refilledInWindowAtomic: bigint
}

export interface RefillRateParams {
  /** Max auto-refilled per rolling window, atomic USDC. `0n` = unlimited (cap off). */
  capAtomic: bigint
  /** Rolling window length, secs. */
  windowSecs: number
  /** Hard manual halt — mirrors edge-auth `set_breaker`; when true, nothing is permitted (§5.4). */
  breakerOpen?: boolean
}

export interface RefillRateCheck {
  /** True if any refill is permitted right now. */
  allowed: boolean
  /** Amount actually permitted this call (≤ requested, capped by remaining window room), atomic USDC. */
  allowedAmountAtomic: bigint
  /** True when the request hit the cap ceiling — the circuit-breaker trip; caller should alert/pause auto-refill. */
  breakerTripped: boolean
  /** Window-rolled state to persist (resets when the window elapsed and reflects the permitted amount). */
  nextState: RefillRateState
}

/**
 * The refill-rate circuit breaker (§5.4, §6). Enforces a max auto-refilled-per-window so a compromised
 * wallet or repeated-fraud pattern can't drain the vault one small buffer-refill at a time. Rolls the
 * window forward deterministically. Reuses the edge-auth breaker instinct: an explicit `breakerOpen`
 * halts everything first (checked before any accounting), exactly like `PortfolioGuard.breaker_open`.
 * A request larger than the remaining window room is permitted only up to that room and flags a trip.
 */
export function checkRefillRate(
  state: RefillRateState,
  requestAtomic: bigint,
  params: RefillRateParams,
  nowSecs: number,
): RefillRateCheck {
  // Roll the window forward first so the returned state is always current.
  const elapsed = nowSecs - state.windowStartSecs
  const rolled: RefillRateState =
    params.windowSecs > 0 && elapsed >= params.windowSecs
      ? { windowStartSecs: nowSecs, refilledInWindowAtomic: 0n }
      : { ...state }

  // Manual breaker halts everything, checked FIRST (mirrors edge-auth authorize_portfolio).
  if (params.breakerOpen) {
    return { allowed: false, allowedAmountAtomic: 0n, breakerTripped: true, nextState: rolled }
  }
  if (requestAtomic <= 0n) {
    return { allowed: false, allowedAmountAtomic: 0n, breakerTripped: false, nextState: rolled }
  }
  // Cap off → unlimited.
  if (params.capAtomic <= 0n) {
    return {
      allowed: true,
      allowedAmountAtomic: requestAtomic,
      breakerTripped: false,
      nextState: { ...rolled, refilledInWindowAtomic: rolled.refilledInWindowAtomic + requestAtomic },
    }
  }
  const room = params.capAtomic - rolled.refilledInWindowAtomic
  if (room <= 0n) {
    // Cap already exhausted this window — hard trip, nothing permitted.
    return { allowed: false, allowedAmountAtomic: 0n, breakerTripped: true, nextState: rolled }
  }
  const permitted = requestAtomic <= room ? requestAtomic : room
  const tripped = requestAtomic > room // asked for more than the window allows
  return {
    allowed: true,
    allowedAmountAtomic: permitted,
    breakerTripped: tripped,
    nextState: { ...rolled, refilledInWindowAtomic: rolled.refilledInWindowAtomic + permitted },
  }
}

// =============================================================================
// lib/web2/router/internalize.ts — order-flow internalization DECISION layer
//
// Phase 3, increment 1. This is the OFF-CHAIN "brain" that decides whether the
// Mintware vault should fill an incoming swap AS THE COUNTERPARTY (in-house
// market maker) instead of routing it to the external aggregator (LI.FI), and
// at what output. It is the tested decision that PRECEDES the on-chain
// vault-as-counterparty FILL contract — which is a separate, large future build
// and is deliberately NOT implemented here (see docs/developers/
// router-internalization-spec.md §10, and the NOTE at the bottom of this file).
//
// It owns exactly the §3.1 "quoteVaultFill + toxicityFilter" seam of the spec:
//   external best (LI.FI)  →  vault mid quote (injected)  →  spread + toxicity
//   →  a fill output that is PROVABLY ≥ the external best  →  else fall back.
//
// HARD BEST-EXECUTION GUARANTEE (spec §6, non-negotiable):
//   When we internalize, the user's output `fillOut` is ALWAYS ≥ the external
//   best `externalBestOut`. The vault can only ever capture spread from the gap
//   between its OWN cost (mid) and the external market — never by degrading the
//   user below what they'd get externally. On every fallback path `fillOut` is
//   set to `externalBestOut` (what LI.FI delivers), so `fillOut ≥ externalBestOut`
//   holds unconditionally, in EVERY branch.
//
// Purity / determinism: this function reads NO env, clock, or randomness. The
// kill switch is an injected `enabled` opt (default OFF), mirroring config.ts,
// so the LI.FI path is byte-for-byte unchanged when internalization is disabled.
// All money math is bigint (no float drift). Compose the result with `pickBest`
// (see NOTE) — that comparator stays the single final best-ex gate, unchanged.
// =============================================================================

/** Optional per-flow toxicity signal. Everything is optional; absence = unknown
 *  (treated as benign for the flag, but the size cap still applies). The on-chain
 *  fill path never sees toxic flow — it's filtered out here, before any quote. */
export interface ToxicitySignal {
  /** Hard "route this out" flag — a classifier upstream marked the flow informed. */
  toxic?: boolean
  /** Free-form label for telemetry (e.g. 'oracle-burst', 'known-sandwicher'). */
  label?: string
}

export interface InternalizeInput {
  /** LI.FI best output for the user, tokenOut base units — THE PRICE TO BEAT. */
  externalBestOut: bigint
  /** Vault's MID quote output (tokenOut base units), BEFORE the vault holds any
   *  spread — i.e. the most the vault could deliver at its own sourcing cost. */
  vaultQuoteOut: bigint
  /** Spread (bps of the vault mid) the vault wants to hold back as its margin.
   *  Clamped to [0, 10_000]. The vault's intended fill = mid × (1 − spread). */
  spreadBps: number
  tokenIn: string
  tokenOut: string
  /** Notional size of the swap in USD — the toxicity/size gate input. */
  sizeUsd: number
  /** Optional explicit toxicity classification (see ToxicitySignal). */
  toxicity?: ToxicitySignal
}

export interface InternalizeOptions {
  /** Kill switch. OFF by default → always falls back to external (LI.FI). */
  enabled?: boolean
  /** Size cap (USD). Flow strictly above this is refused (routed out) — the
   *  documented toxicity gate: large-for-the-pair flow is the classic informed
   *  signal. Default DEFAULT_MAX_SIZE_USD. */
  maxSizeUsd?: number
  /** Minimum captured spread (bps of the vault mid) for internalizing to be worth
   *  the inventory risk. Below this we route out. Default 0 (any positive spread). */
  minCaptureBps?: number
}

/** Why internalization did / didn't happen — surfaced for telemetry + the
 *  best-route decision record (auditability of the best-ex claim, spec §6). */
export type InternalizeReason =
  | 'internalize-disabled'   // kill switch off (default) → external, unchanged
  | 'invalid-input'          // malformed amounts/size/spread → route out (safe)
  | 'toxic-flow'             // explicit toxic flag → route out (never touches inventory)
  | 'size-over-cap'          // sizeUsd > maxSizeUsd → route out
  | 'external-better'        // vault mid can't even match external → best-ex floor protects user
  | 'spread-too-thin'        // captured spread < minCaptureBps → not worth inventory risk
  | 'internalized'           // vault fills; fillOut ≥ external, positive spread captured

export interface InternalizeDecision {
  /** True ONLY on the 'internalized' path. */
  internalize: boolean
  /** Output the user receives on the CHOSEN route, tokenOut base units.
   *  INVARIANT: always ≥ externalBestOut (best-ex guarantee). On any fallback
   *  this equals externalBestOut (the user takes the external route). */
  fillOut: bigint
  /** Spread the vault keeps, tokenOut base units (= vaultQuoteOut − fillOut).
   *  0 on every fallback path. Always ≥ 0. */
  capturedSpreadOut: bigint
  /** Captured spread as bps of the vault mid. 0 on fallback. */
  capturedSpreadBps: number
  /** How much better than external the user gets (= fillOut − externalBestOut).
   *  Always ≥ 0. > 0 means the internal fill strictly improves on external. */
  improvementOut: bigint
  reason: InternalizeReason
}

/** Default max notional a single internalized fill may carry (USD). Conservative
 *  — internalization starts with small caps on benign pairs (spec §11). */
export const DEFAULT_MAX_SIZE_USD = 100_000

const BPS = 10_000n

/** Clamp a bps value to an integer in [0, 10_000]. Non-finite → 0. */
function clampBps(bps: number): number {
  if (!Number.isFinite(bps)) return 0
  const i = Math.floor(bps)
  if (i < 0) return 0
  if (i > 10_000) return 10_000
  return i
}

/** Build a fallback decision: the user takes the external route, so fillOut is
 *  the external best and nothing is captured. Keeps fillOut ≥ external trivially. */
function fallback(externalBestOut: bigint, reason: InternalizeReason): InternalizeDecision {
  const ext = externalBestOut > 0n ? externalBestOut : 0n
  return {
    internalize: false,
    fillOut: ext,
    capturedSpreadOut: 0n,
    capturedSpreadBps: 0,
    improvementOut: 0n,
    reason,
  }
}

/**
 * Decide whether to internalize a swap against vault inventory, and at what output.
 *
 * Rules (evaluated in this order; the FIRST that trips wins → deterministic):
 *  1. Disabled (default)                         → external      ('internalize-disabled')
 *  2. Malformed input (bad amounts/size/spread)  → external      ('invalid-input')
 *  3. Explicit toxic flag                        → external      ('toxic-flow')
 *  4. sizeUsd > maxSizeUsd                        → external      ('size-over-cap')
 *  5. vaultQuoteOut < externalBestOut             → external      ('external-better')
 *     (the vault's own mid can't match the external best → cannot satisfy best-ex
 *      without a loss; the user is strictly better off external.)
 *  6. Otherwise the vault fills:
 *       intendedFill = vaultQuoteOut × (1 − spreadBps)          (vault's desired fill)
 *       fillOut      = max(intendedFill, externalBestOut)        (best-ex FLOOR)
 *       captured     = vaultQuoteOut − fillOut  (≥ 0)
 *     If captured < minCaptureBps of the mid    → external       ('spread-too-thin')
 *     else                                       → INTERNALIZE   ('internalized')
 *
 * The best-ex guarantee is structural: fillOut = max(_, externalBestOut) can never
 * dip below the external best, and captured = mid − fillOut ≤ mid − external, so the
 * vault only ever keeps value that sits between its cost and the external market.
 *
 * Pure & deterministic: identical (input, opts) → identical decision. No I/O.
 */
export function decideInternalize(
  input: InternalizeInput,
  opts: InternalizeOptions = {},
): InternalizeDecision {
  const { externalBestOut, vaultQuoteOut, spreadBps, sizeUsd, toxicity } = input
  const enabled = opts.enabled ?? false
  const maxSizeUsd = Number.isFinite(opts.maxSizeUsd as number) ? (opts.maxSizeUsd as number) : DEFAULT_MAX_SIZE_USD
  const minCaptureBps = clampBps(opts.minCaptureBps ?? 0)

  // 1. Kill switch — OFF by default. Nothing changes for the LI.FI path.
  if (!enabled) return fallback(externalBestOut, 'internalize-disabled')

  // 2. Input validity. Any malformed money/size → route out (never guess).
  const validAmounts =
    typeof externalBestOut === 'bigint' &&
    typeof vaultQuoteOut === 'bigint' &&
    externalBestOut > 0n &&
    vaultQuoteOut >= 0n
  const validSize = Number.isFinite(sizeUsd) && sizeUsd >= 0
  const validSpread = Number.isFinite(spreadBps) && spreadBps >= 0
  if (!validAmounts || !validSize || !validSpread) {
    return fallback(externalBestOut, 'invalid-input')
  }

  // 3. Toxicity — explicit "informed flow" flag. Route out before any inventory
  //    touch (spec §6: the single most important risk control).
  if (toxicity?.toxic === true) return fallback(externalBestOut, 'toxic-flow')

  // 4. Size cap — large-for-the-pair flow is the classic toxic signal.
  if (sizeUsd > maxSizeUsd) return fallback(externalBestOut, 'size-over-cap')

  // 5. Best-ex feasibility — the vault's own mid must at least match external,
  //    else it cannot deliver ≥ external without selling below cost.
  if (vaultQuoteOut < externalBestOut) return fallback(externalBestOut, 'external-better')

  // 6. Price the fill. Vault's intended (post-spread) fill, floored at external.
  const s = BigInt(clampBps(spreadBps))
  const intendedFill = (vaultQuoteOut * (BPS - s)) / BPS   // floor: sub-unit dust favors the vault, never the user below floor
  const fillOut = intendedFill > externalBestOut ? intendedFill : externalBestOut
  const capturedSpreadOut = vaultQuoteOut - fillOut         // ≥ 0: fillOut ≤ vaultQuoteOut always (see below)
  const capturedSpreadBps =
    vaultQuoteOut > 0n ? Number((capturedSpreadOut * BPS) / vaultQuoteOut) : 0

  // fillOut ≤ vaultQuoteOut proof: intendedFill ≤ vaultQuoteOut (spread ≥ 0) and
  // externalBestOut ≤ vaultQuoteOut (step 5), so max(_, _) ≤ vaultQuoteOut.

  // Not worth the inventory risk if the captured spread is too thin.
  if (capturedSpreadOut <= 0n || capturedSpreadBps < minCaptureBps) {
    return fallback(externalBestOut, 'spread-too-thin')
  }

  return {
    internalize: true,
    fillOut,
    capturedSpreadOut,
    capturedSpreadBps,
    improvementOut: fillOut - externalBestOut,   // ≥ 0
    reason: 'internalized',
  }
}

// -----------------------------------------------------------------------------
// Optional env-backed gating — kept SEPARATE from the pure decision above so the
// core stays deterministic/testable. Callers read this and pass `enabled` in.
// Mirrors config.ts (NEXT_PUBLIC_MW_ROUTER_ENABLED) — internalization is a strict
// SUBSET of the router being on: it can only be enabled when the router itself is.
// -----------------------------------------------------------------------------

/** Master switch for internalization. OFF unless BOTH the router is enabled AND
 *  the internalize flag is explicitly 'true'. Never reads inside decideInternalize. */
export function isInternalizeEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_MW_ROUTER_ENABLED === 'true' &&
    process.env.NEXT_PUBLIC_MW_INTERNALIZE_ENABLED === 'true'
  )
}

/** Env-configured size cap (USD), clamped to a sane positive number; default cap. */
export function internalizeMaxSizeUsd(): number {
  const raw = Number(process.env.NEXT_PUBLIC_MW_INTERNALIZE_MAX_SIZE_USD)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_SIZE_USD
  return raw
}

// =============================================================================
// NOTE — SCOPE. This module is the OFF-CHAIN DECISION LAYER ONLY.
//
//   * It decides internalize? and computes a best-ex-safe fillOut from INJECTED
//     quotes. It does NOT read a live quoter, hold inventory, or execute anything.
//   * The vault-as-counterparty on-chain FILL contract (flash-source the OUT
//     asset, take the IN asset, deliver at ≥ external under an amountOutMinimum
//     floor, record the inventory delta) is a SEPARATE, large future increment —
//     see spec §10 "NEEDED" + §3.1. Nothing here executes a fill.
//   * Also future: the real inventory/risk manager (bands, netting, hedging) that
//     would PRODUCE `vaultQuoteOut` and a richer toxicity classifier. Here both
//     are injected inputs.
//
// COMPOSITION with pickBest (unchanged): a caller turns a positive decision into
// the internal NetQuote it hands to `pickBest` alongside the LI.FI NetQuote —
// `buyAmount: decision.fillOut`. `pickBest` remains the single FINAL best-ex gate
// (strict, gas-inclusive, ties → LI.FI). Because fillOut ≥ externalBestOut here,
// this layer can never present pickBest a quote worse than external; pickBest then
// applies its own strict margin. When `enabled` is false this returns a fallback
// with internalize=false and fillOut=externalBestOut, so the LI.FI path is unchanged.
// =============================================================================

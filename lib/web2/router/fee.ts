// =============================================================================
// lib/web2/router/fee.ts — Mintware router fee (protocol cut on internal swaps)
//
// The router fee is the internal-path equivalent of today's 0.5% LI.FI referrer
// fee: taken by MWRouter from the swap output, sent to treasury. It is SEPARATE
// from the FeeVault participant buckets (LP/referrer/protocol/attribution).
// Design + rationale: docs/developers/phase3-router-design.md §7.4.
//
// Pure bigint math — no float drift. The on-chain MWRouter enforces the same cap.
// =============================================================================

/** Default router fee: 0.5% — parity with the LI.FI referrer fee (chainConfig.feeBps = 50). */
export const ROUTER_FEE_BPS_DEFAULT = 50

/** Hard cap enforced off-chain AND on-chain (MWRouter.setRouterFeeBps). Fee can never exceed this. */
export const ROUTER_FEE_BPS_CAP = 100

const BPS = 10_000n

/**
 * Clamp a requested fee to a safe integer bps in [0, cap].
 * Non-finite / undefined → default. Negative → 0. Above cap → cap.
 */
export function normalizeRouterFeeBps(bps: number | undefined | null): number {
  if (bps == null || !Number.isFinite(bps)) return ROUTER_FEE_BPS_DEFAULT
  const int = Math.floor(bps)
  if (int < 0) return 0
  if (int > ROUTER_FEE_BPS_CAP) return ROUTER_FEE_BPS_CAP
  return int
}

export interface RouterFeeSplit {
  /** Amount delivered to the user — gross output minus the fee. */
  net: bigint
  /** Fee skimmed to treasury. */
  fee: bigint
}

/**
 * Skim the router fee from a gross output amount, mirroring MWRouter taking the
 * fee from the output token. `feeBps` is clamped via normalizeRouterFeeBps, so
 * this can never over-charge even if handed a bad value.
 *
 * Rounding: integer floor division on the fee → any dust favors the USER (they
 * receive net = gross - floor(fee)). Never rounds against the user.
 */
export function applyRouterFee(grossOut: bigint, feeBps: number): RouterFeeSplit {
  if (grossOut <= 0n) return { net: 0n, fee: 0n }
  const bps = BigInt(normalizeRouterFeeBps(feeBps))
  const fee = (grossOut * bps) / BPS
  return { net: grossOut - fee, fee }
}

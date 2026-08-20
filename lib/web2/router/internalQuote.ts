// =============================================================================
// lib/web2/router/internalQuote.ts — internal (MW-pool) quote → NetQuote
//
// The on-chain price read (V4 Quoter / StateView) lands in Slice 2 alongside
// MWRouter.sol, when there is a deployed pool to read from and fork-test against.
// This module owns the pure, testable-NOW part: turning a raw pool quote into a
// NetQuote with the router fee skimmed and the output valued in USD. The on-chain
// reader is INJECTED and is null today → no internal quote → LI.FI.
// =============================================================================

import type { ListedPool, NetQuote } from './types'
import { applyRouterFee } from './fee'

/** Raw output of an on-chain pool quote, BEFORE Mintware's router fee. */
export interface RawPoolQuote {
  /** Gross output in buy-token base units, before router fee, as the pool fills. */
  grossOut: bigint
  /** USD value of 1.0 whole buy token, if known (used to value output + LI.FI side). */
  buyTokenPriceUsd: number | null
  /** Network fee estimate in USD, if known. */
  gasCostUsd: number | null
  /** Price-impact % from the pool's depth, if known. */
  priceImpactPct: number | null
  /** Buy-token decimals (to value the output in USD). */
  buyTokenDecimals: number
}

/** Reads a raw quote from an on-chain MW pool. Null until Slice 2 wires the V4 Quoter. */
export interface QuoterReader {
  quote(pool: ListedPool, amountIn: bigint): Promise<RawPoolQuote | null>
}

/**
 * Value a base-unit token amount in USD given a per-whole-token price.
 * Returns null when price is unknown or inputs are out of range. Approximate to
 * the dollar (fine for ranking) — never used for on-chain settlement amounts.
 */
export function valueUsd(amount: bigint, decimals: number, priceUsd: number | null): number | null {
  if (priceUsd == null || !Number.isFinite(priceUsd) || priceUsd < 0) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  if (amount < 0n) return null
  const whole = Number(amount) / 10 ** decimals
  if (!Number.isFinite(whole)) return null
  const usd = whole * priceUsd
  return Number.isFinite(usd) ? usd : null
}

/**
 * Normalize a raw pool quote into a NetQuote: skim the router fee off the output,
 * value the NET output in USD (at the pool's buy-token price), carry gas + impact.
 * Pure — fully testable now.
 */
export function normalizeInternalQuote(raw: RawPoolQuote, routerFeeBps: number): NetQuote {
  const { net, fee } = applyRouterFee(raw.grossOut, routerFeeBps)
  return {
    provider: 'mw-internal',
    buyAmount: net,
    buyAmountUsd: valueUsd(net, raw.buyTokenDecimals, raw.buyTokenPriceUsd),
    gasCostUsd: raw.gasCostUsd,
    feeUsd: valueUsd(fee, raw.buyTokenDecimals, raw.buyTokenPriceUsd),
    priceImpactPct: raw.priceImpactPct,
  }
}

/**
 * Full internal-quote path: read the pool via the injected reader, normalize.
 * Returns null (→ LI.FI) when no reader is configured, the amount is non-positive,
 * or the read fails/throws/returns empty. The raw quote is also returned so the
 * orchestrator can value the LI.FI output at the SAME buy-token price.
 */
export async function quoteInternalPool(
  pool: ListedPool,
  amountIn: bigint,
  routerFeeBps: number,
  reader: QuoterReader | null,
): Promise<{ quote: NetQuote; raw: RawPoolQuote } | null> {
  if (!reader) return null
  if (amountIn <= 0n) return null
  try {
    const raw = await reader.quote(pool, amountIn)
    if (!raw || raw.grossOut <= 0n) return null
    return { quote: normalizeInternalQuote(raw, routerFeeBps), raw }
  } catch {
    return null
  }
}

// LP-gateway operational knobs (Krystal item 15) — one typed home for the keeper/harvest control surface.
// Each is env-driven and fail-safe defaulted; consumed by the harvest destination (item 14) and the
// circuit breaker (item 13). No behaviour of its own — pure config resolution. Everything OFF/inert by
// default, so the gateway is byte-for-byte unchanged until an operator opts a knob on.

export type HarvestDestination = 'buffer' | 'restake'

/** Superseded — the actual money-path resolver is `lib/gateway/harvest.ts#resolveHarvestDestination` (the
 *  one every consumer actually calls); this one is unused in production. **Earn-vs-LP decision
 *  (docs/developers/lp-gateway-earn-vs-lp-decision.md, 2026-09-08): the A-4 buffer ledger is dropped —
 *  LP-Gateway V1 never grows a buffer** — so this now always agrees with that resolver ('restake') rather
 *  than keep a stale, contradictory 'buffer' default alive here. */
export function harvestDestination(): HarvestDestination {
  return 'restake'
}

/** Circuit breaker (item 13): auto-PAUSE new deposits on a sustained out-of-range alert. Never
 *  auto-unpauses (re-opening a just-recovered pool is a human decision). OFF by default. */
export function circuitBreakerEnabled(): boolean {
  return process.env.LP_GATEWAY_CIRCUIT_BREAKER_ENABLED === 'true'
}

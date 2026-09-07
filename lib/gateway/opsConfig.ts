// LP-gateway operational knobs (Krystal item 15) — one typed home for the keeper/harvest control surface.
// Each is env-driven and fail-safe defaulted; consumed by the harvest destination (item 14) and the
// circuit breaker (item 13). No behaviour of its own — pure config resolution. Everything OFF/inert by
// default, so the gateway is byte-for-byte unchanged until an operator opts a knob on.

export type HarvestDestination = 'buffer' | 'restake'

/** Where harvested net fees go: 'buffer' (default — credit each depositor's spendable buffer, the
 *  "spend from yield" model) or 'restake' (compound back into Morpho, lifting NAV pro-rata). */
export function harvestDestination(): HarvestDestination {
  return (process.env.LP_GATEWAY_HARVEST_DESTINATION ?? 'buffer').toLowerCase() === 'restake' ? 'restake' : 'buffer'
}

/** Circuit breaker (item 13): auto-PAUSE new deposits on a sustained out-of-range alert. Never
 *  auto-unpauses (re-opening a just-recovered pool is a human decision). OFF by default. */
export function circuitBreakerEnabled(): boolean {
  return process.env.LP_GATEWAY_CIRCUIT_BREAKER_ENABLED === 'true'
}

// Yield-venue registry for the live rate-keeper (Phase 1b) — the venue key → child `IYieldAdapter`
// address map that `MintwareMultiVenueYieldAdapter.setVenues(...)` points at, plus the DefiLlama
// matcher that gives each venue its live supply rate.
//
// The VENUE DEFINITIONS (which lending markets we shop across + how to read their live rate) live
// here in code; the DEPLOYED CHILD-ADAPTER ADDRESSES come from env (`YIELD_VENUES_JSON`, a
// {key: "0x…"} map) because they only exist after a Foundry deploy. Default = no addresses wired
// (empty/testnet posture): the keeper can still compute + return a plan (dry-run), it just has
// nothing to submit to. TESTNET/UNAUDITED — see lib/yield/rateKeeper.ts.

export type VenueMatcher = {
  /** DefiLlama `project` slug (e.g. 'aave-v3', 'morpho-blue'). */
  project: string
  /** Match against DefiLlama `symbol`; deepest-TVL match wins. */
  symbol: RegExp
  /** Ignore pools below this TVL (dust / dead markets). */
  minTvlUsd?: number
}

export type YieldVenue = {
  /** Stable venue id — the keeper maps this to the child adapter address for `setVenues`. */
  key: string
  label: string
  /** Deployed child `IYieldAdapter` address, or null until one is wired via env. */
  adapter: `0x${string}` | null
  /** How to read this venue's live supply APY off the DefiLlama feed. */
  llama: VenueMatcher
}

// The USDC lending markets idle capital shops across. Real DefiLlama-listed venues; adapters are
// null by default (testnet) and filled from `YIELD_VENUES_JSON` when deployed. `apyBase` only
// (supply/fee component — token-reward bribes excluded), the honest keepable rate.
const DEFAULT_VENUES: readonly Omit<YieldVenue, 'adapter'>[] = [
  { key: 'aave-v3-usdc', label: 'Aave v3 USDC', llama: { project: 'aave-v3', symbol: /^USDC$/, minTvlUsd: 10_000_000 } },
  { key: 'morpho-usdc', label: 'Morpho USDC (curated)', llama: { project: 'morpho-blue', symbol: /USDC/, minTvlUsd: 100_000_000 } },
  { key: 'fluid-usdc', label: 'Fluid USDC', llama: { project: 'fluid-lending', symbol: /^USDC$/, minTvlUsd: 10_000_000 } },
  { key: 'compound-v3-usdc', label: 'Compound v3 USDC', llama: { project: 'compound-v3', symbol: /^USDC$/, minTvlUsd: 10_000_000 } },
]

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * Parse the `YIELD_VENUES_JSON` env override — a `{ "<venueKey>": "0x<adapter>" }` map of deployed
 * child-adapter addresses. Malformed JSON or non-address values are ignored (return {}), so a bad
 * env can never inject a garbage address into a `setVenues` plan.
 */
export function parseVenueAdapterOverrides(raw: string | undefined): Record<string, `0x${string}`> {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, `0x${string}`> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string' && ADDR_RE.test(v)) out[k] = v as `0x${string}`
  }
  return out
}

/**
 * The configured venues with their deployed adapter addresses resolved from env. Pass the env map
 * for testability; defaults to `process.env.YIELD_VENUES_JSON`.
 */
export function getYieldVenues(env: NodeJS.ProcessEnv = process.env): YieldVenue[] {
  const overrides = parseVenueAdapterOverrides(env.YIELD_VENUES_JSON)
  return DEFAULT_VENUES.map((v) => ({ ...v, adapter: overrides[v.key] ?? null }))
}

/** DefiLlama matchers keyed by venue id — the shape `lib/yield/rateFeed.ts` consumes. */
export function venueMatchers(venues: YieldVenue[]): Record<string, VenueMatcher> {
  return Object.fromEntries(venues.map((v) => [v.key, v.llama]))
}

export type KeeperConfig = {
  /** Master switch — `'true'` opts this route into (a future) on-chain submit. Default off. */
  enabled: boolean
  /** Funded keeper key present? (never read/logged here — presence only). */
  hasKey: boolean
  /** Deployed `MintwareMultiVenueYieldAdapter` (the parent whose `setVenues` we'd call). */
  multiVenueAdapter: `0x${string}` | null
  /** Re-weight drift threshold (bps) — below this a keeper wouldn't pay gas. */
  minDeltaBps: number
}

/**
 * The submit-side gates. This route NEVER submits a tx (that needs a funded keeper key + the
 * deployed multi-venue adapter, both deploy-gated); this only reports whether those preconditions
 * are met so the dry-run can say what a live keeper *would* do.
 */
export function keeperConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const adapter = env.YIELD_MULTIVENUE_ADAPTER
  return {
    enabled: env.YIELD_KEEPER_ENABLED === 'true',
    hasKey: !!env.YIELD_KEEPER_PRIVATE_KEY,
    multiVenueAdapter: adapter && ADDR_RE.test(adapter) ? (adapter as `0x${string}`) : null,
    minDeltaBps: Number(env.YIELD_MIN_DELTA_BPS ?? 500),
  }
}

/** True only when every submit precondition is wired. Even then this PR does not submit. */
export function keeperReady(cfg: KeeperConfig, venues: YieldVenue[]): boolean {
  return cfg.enabled && cfg.hasKey && !!cfg.multiVenueAdapter && venues.some((v) => v.adapter)
}

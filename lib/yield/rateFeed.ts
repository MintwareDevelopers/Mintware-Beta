// Live venue-rate feed for the rate-keeper — the same DefiLlama pools dataset the /api/benchmarks/yields
// route already serves, read here as a plain {venueKey → live APY%} lookup for the keeper's plan.
//
// Deliberately mirrors the benchmarks route: one shared ~11MB DefiLlama fetch, module-memoized for an
// hour (Next's fetch cache won't store >2MB), `apyBase` only (supply/fee — token-reward bribes excluded,
// the honest keepable number), deepest-TVL match wins. Fails soft: any upstream problem returns
// { ok:false, ratesByKey:{} } so the keeper produces an empty plan (capital stays put) rather than
// acting on invented rates. Pure read — no auth, no on-chain. TESTNET/UNAUDITED.

import type { VenueMatcher } from '@/config/yieldVenues'

const LLAMA_POOLS = 'https://yields.llama.fi/pools'
const TTL_MS = 60 * 60 * 1000 // 1h
const DEFAULT_MIN_TVL = 1_000_000

type LlamaPool = {
  chain: string; project: string; symbol: string; tvlUsd: number
  apyBase: number | null
}

let CACHE: { at: number; pools: LlamaPool[] } | null = null
let inflight: Promise<LlamaPool[]> | null = null

async function loadPools(): Promise<LlamaPool[]> {
  if (CACHE && Date.now() - CACHE.at < TTL_MS) return CACHE.pools
  if (inflight) return inflight
  inflight = (async () => {
    const res = await fetch(LLAMA_POOLS, { cache: 'no-store' })
    if (!res.ok) throw new Error(`DefiLlama ${res.status}`)
    const json = await res.json()
    const pools: LlamaPool[] = json?.data ?? json
    if (!Array.isArray(pools)) throw new Error('unexpected DefiLlama shape')
    CACHE = { at: Date.now(), pools }
    return pools
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

function pick(pools: LlamaPool[], m: VenueMatcher): LlamaPool | null {
  const minTvl = m.minTvlUsd ?? DEFAULT_MIN_TVL
  return pools
    .filter((p) => p.project === m.project && m.symbol.test(p.symbol) && p.tvlUsd >= minTvl && p.apyBase != null && p.apyBase > 0)
    .sort((a, b) => b.tvlUsd - a.tvlUsd)[0] ?? null
}

export type VenueRateFeed = {
  ok: boolean
  source: 'DefiLlama'
  asOf: string
  /** venueKey → live supply APY as a percentage (5.5 = 5.50%); null when no live pool matched. */
  ratesByKey: Record<string, number | null>
  error?: string
}

/**
 * Read live supply APY (%) for each configured venue off the DefiLlama feed. `matchers` is the
 * {venueKey → DefiLlama matcher} map from `venueMatchers(getYieldVenues())`. Fails soft to
 * `{ ok:false, ratesByKey:{} }` on any upstream error.
 */
export async function fetchVenueRates(matchers: Record<string, VenueMatcher>): Promise<VenueRateFeed> {
  let pools: LlamaPool[]
  try {
    pools = await loadPools()
  } catch (e) {
    return { ok: false, source: 'DefiLlama', asOf: new Date().toISOString(), ratesByKey: {}, error: String(e) }
  }
  const ratesByKey: Record<string, number | null> = {}
  for (const [key, m] of Object.entries(matchers)) {
    ratesByKey[key] = pick(pools, m)?.apyBase ?? null
  }
  return { ok: true, source: 'DefiLlama', asOf: new Date(CACHE?.at ?? Date.now()).toISOString(), ratesByKey }
}

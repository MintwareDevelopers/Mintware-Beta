import { createHandler } from '@/lib/web2/routeHandler'

// GET /api/benchmarks/yields — live, sourced yield benchmarks for /the-math.
// Pulls DefiLlama's public yields dataset and returns a small, curated set of REAL pools
// (lending floor + stable-LP fees + a volatile-LP contrast) so the page can anchor every
// number to something actually earning today — never a made-up figure. `apyBase` is the
// fee/supply component only (token-reward bribes excluded), which is the honest "keepable"
// number. Fails soft: on any upstream problem returns { ok:false } and the page shows a
// "couldn't load live rates" state rather than inventing values.
//
// Web2 grouping (fast read API). DefiLlama /pools is ~11MB, so we memoize the parsed feed in
// module memory for an hour instead of relying on Next's fetch cache (which won't store >2MB).

export const dynamic = 'force-dynamic'

const LLAMA_POOLS = 'https://yields.llama.fi/pools'
const TTL_MS = 60 * 60 * 1000 // 1h
const MIN_TVL = 1_000_000     // ignore dust / dead pools

type LlamaPool = {
  chain: string; project: string; symbol: string; tvlUsd: number
  apy: number | null; apyBase: number | null; apyReward: number | null
  apyMean30d: number | null; volumeUsd1d: number | null
  stablecoin: boolean; ilRisk: string
}

type Feed = { at: number; pools: LlamaPool[] }
let CACHE: Feed | null = null
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
  try { return await inflight } finally { inflight = null }
}

// Curated targets, matched by (project, symbol, chain) rather than fragile pool ids so a
// re-listed pool still resolves. Each picks the deepest (max-TVL) real match.
type Kind = 'floor' | 'fees' | 'volatile'
const TARGETS: { key: string; label: string; blurb: string; kind: Kind; match: (p: LlamaPool) => boolean }[] = [
  { key: 'aave-usdc-base', label: 'Aave v3 · USDC', blurb: 'Idle-cash lending rate on Base', kind: 'floor',
    match: p => p.project === 'aave-v3' && p.symbol === 'USDC' && p.chain === 'Base' },
  { key: 'aave-usdc-eth', label: 'Aave v3 · USDC', blurb: 'Idle-cash lending rate on Ethereum', kind: 'floor',
    match: p => p.project === 'aave-v3' && p.symbol === 'USDC' && p.chain === 'Ethereum' },
  { key: 'morpho-usdc', label: 'Morpho · USDC', blurb: 'Optimized lending on Aave/Compound', kind: 'floor',
    match: p => /morpho/.test(p.project) && p.symbol === 'USDC' && (p.apyBase ?? 0) > 0 },
  { key: 'uni-usdc-usdt', label: 'Uniswap v3 · USDC/USDT', blurb: 'Stable-pair swap fees — no IL', kind: 'fees',
    match: p => p.project === 'uniswap-v3' && /^(USDC-USDT|USDT-USDC)$/.test(p.symbol) },
  { key: 'uni-dai-usdc', label: 'Uniswap v3 · DAI/USDC', blurb: 'Stable-pair fees, higher turnover', kind: 'fees',
    match: p => p.project === 'uniswap-v3' && /^(DAI-USDC|USDC-DAI)$/.test(p.symbol) },
  { key: 'uni-eth-usdc', label: 'Uniswap v3 · ETH/USDC', blurb: 'Volatile pair — high fees, but IL risk', kind: 'volatile',
    match: p => p.project === 'uniswap-v3' && /^(USDC-WETH|WETH-USDC)$/.test(p.symbol) && p.chain === 'Ethereum' },
]

function pick(pools: LlamaPool[], match: (p: LlamaPool) => boolean): LlamaPool | null {
  return pools
    .filter(p => match(p) && p.tvlUsd >= MIN_TVL && p.apyBase != null)
    .sort((a, b) => b.tvlUsd - a.tvlUsd)[0] ?? null
}

export const GET = createHandler(async (_req, ctx) => {
  let pools: LlamaPool[]
  try {
    pools = await loadPools()
  } catch (e) {
    ctx.log.warn('benchmarks', 'DefiLlama fetch failed', { error: String(e) })
    return ctx.json({ ok: false, error: 'live_rates_unavailable' }, 200)
  }

  const rows = TARGETS.map(t => {
    const p = pick(pools, t.match)
    if (!p) return null
    return {
      key: t.key, label: t.label, blurb: t.blurb, kind: t.kind,
      chain: p.chain, symbol: p.symbol,
      // apyBase = fee/supply only (excludes token-reward bribes) — the honest keepable number.
      apyBase: p.apyBase,
      apyMean30d: p.apyMean30d,
      apyReward: p.apyReward,
      tvlUsd: p.tvlUsd,
      volumeUsd1d: p.volumeUsd1d,
      stablecoin: p.stablecoin,
      ilRisk: p.ilRisk,
    }
  }).filter(Boolean)

  return ctx.json({
    ok: true,
    source: 'DefiLlama',
    sourceUrl: 'https://defillama.com/yields',
    asOf: new Date(CACHE?.at ?? Date.now()).toISOString(),
    rows,
  })
})

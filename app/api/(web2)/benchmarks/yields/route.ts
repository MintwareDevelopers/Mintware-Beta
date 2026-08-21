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

// Two sides of one question: what does a pool BACKED BY USDC earn vs one BACKED BY ETH?
// Each side has a `floor` (what the idle asset earns — USDC lending vs ETH staking) and `fees`
// (what it earns as swap liquidity — a stable pair vs an ETH pair). Real pools, matched by
// (project, symbol) not fragile ids, deepest match wins. `apyBase` only (token-reward bribes
// excluded). `ilRisk` tells the page whether the fees are keepable (stable ≈ yes, ETH pair = IL).
//
// Note: DefiLlama files Morpho vaults under project `morpho-blue` with per-vault symbols
// (STEAKUSDC, GTUSDCP…), NOT a bare "USDC" — so the USDC floor matches /USDC/ on the symbol and
// picks the deepest, which surfaces the real curated vaults instead of dropping them.
type Side = 'usdc' | 'eth'
type Layer = 'floor' | 'fees'
const TARGETS: {
  key: string; side: Side; layer: Layer; label: string; blurb: string; riskNote?: string
  match: (p: LlamaPool) => boolean
}[] = [
  // ── USDC-backed ──────────────────────────────────────────────────────────
  { key: 'usdc-floor', side: 'usdc', layer: 'floor', label: 'Curated USDC lending', blurb: 'Idle USDC lent out — best curated vault (Morpho)',
    riskNote: 'Curated lending vault — higher yield than base Aave, with curator risk',
    match: p => p.project === 'morpho-blue' && /USDC/.test(p.symbol) && (p.apyBase ?? 0) > 0 && p.tvlUsd > 100e6 },
  { key: 'usdc-fees', side: 'usdc', layer: 'fees', label: 'USDC stable pair', blurb: 'USDC/USDT swap fees — 1bp tier, no IL',
    match: p => p.project === 'uniswap-v3' && /^(USDC-USDT|USDT-USDC)$/.test(p.symbol) },
  // ── ETH-backed ───────────────────────────────────────────────────────────
  { key: 'eth-floor', side: 'eth', layer: 'floor', label: 'ETH staking', blurb: 'Idle ETH staked — the base ETH yield',
    riskNote: 'Liquid staking — validator/slashing + peg risk, not a dollar',
    match: p => p.project === 'lido' && p.symbol === 'STETH' },
  { key: 'eth-fees', side: 'eth', layer: 'fees', label: 'ETH pair', blurb: 'ETH/USDC swap fees — higher tier, big volume',
    riskNote: 'Volatile pair — fees are large but IL + ETH price move eat into them',
    match: p => p.project === 'uniswap-v3' && /^(WETH-USDC|USDC-WETH)$/.test(p.symbol) && (p.apyBase ?? 0) > 0 },
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
      key: t.key, side: t.side, layer: t.layer, label: t.label, blurb: t.blurb,
      riskNote: t.riskNote ?? null,
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

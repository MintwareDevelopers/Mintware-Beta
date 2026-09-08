import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listActiveInstances } from '@/lib/gateway/registry'
import { readInstanceHoldings } from '@/lib/gateway/chainTruth'
import { rankProviders, rankProvidersFromDb, type ProviderStanding } from '@/lib/gateway/leaderboard'
import { leaderboardCache } from '@/lib/gateway/leaderboardCache'

export const dynamic = 'force-dynamic'

// GET — PUBLIC. The V1 leaderboard: ranks OBSERVABLE activity only — capital at work (current on-chain
// position value across pools) and referrals brought — never a trust/credit signal or the Attribution
// score. Testnet "Season 0": standings are illustrative and may reset.
//
// O-11 (audit 2026-09-08): the providers board used to sum DB `entry_nav`, which inflates when a withdraw
// isn't recorded. It now reads CHAIN truth: `gateway_positions` supplies depositor ADDRESSES only; per
// active instance we read `sharesOf(addr)` + `totalShares()` + `totalNav()` at one block and rank by
// shares × totalNav / totalShares (floor, offset-consistent). `source:'chain'` + `blockNumber` +
// staleness are exposed. If the RPC read fails the board degrades to the DB sum with an EXPLICIT
// `source:'db', degraded:true` flag — never silently mixed. Cached 60 s (chain) / 15 s (degraded).
// `?me=<addr>` also returns the caller's own rank on each board even when off the visible top-N.

const TOP_N = 50
const MAX_WALLETS_PER_POOL = 500
const CHAIN_TTL_MS = 60_000
const DEGRADED_TTL_MS = 15_000
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

type ProviderRow = { rank: number; wallet: string; label: string; capitalAtomic: string; shares: string; pools: number }
type ProvidersBoard = {
  source: 'chain' | 'db' | 'none'
  degraded: boolean
  degradedReason: string | null
  blockNumber: string | null
  chainId: number | null
  computedAt: number
  ttlMs: number
  all: ProviderRow[]
}

// Module-level cache (per serverless instance) — lives in lib/gateway/leaderboardCache.ts (route modules may
// only export handlers). Keyed by chain so a config change never serves a stale board.
const cache = leaderboardCache as Map<string, ProvidersBoard>

const toRows = (standings: ProviderStanding[]): ProviderRow[] =>
  standings.map((p) => ({ rank: p.rank, wallet: p.wallet, label: short(p.wallet), capitalAtomic: p.valueAtomic.toString(), shares: p.shares.toString(), pools: p.pools }))

type PosRow = { user_wallet: string; entry_nav: unknown; pool_address: string }

async function buildProvidersBoard(
  supabase: Parameters<typeof listActiveInstances>[0],
  cfg: ReturnType<typeof gatewayConfig>,
  log: { warn: (tag: string, msg: string, meta?: Record<string, unknown>) => void },
): Promise<ProvidersBoard> {
  const now = Date.now()
  // Address source (+ the degraded fallback's inputs). Never a money number on the chain path.
  let q = supabase.from('gateway_positions').select('user_wallet, entry_nav, pool_address')
  if (cfg?.chainId) q = q.eq('chain_id', cfg.chainId)
  const { data } = await q
  const rows = (data ?? []) as PosRow[]

  if (!cfg) {
    // No chain configured — the only honest option is the DB sum, flagged.
    return { source: rows.length ? 'db' : 'none', degraded: true, degradedReason: 'gateway_not_configured', blockNumber: null, chainId: null, computedAt: now, ttlMs: DEGRADED_TTL_MS, all: toRows(rankProvidersFromDb(rows)) }
  }

  try {
    const instances = await listActiveInstances(supabase, cfg.chainId)
    const walletsByPool = new Map<string, Set<string>>()
    for (const r of rows) {
      const pool = String(r.pool_address).toLowerCase()
      const set = walletsByPool.get(pool) ?? new Set<string>()
      if (set.size < MAX_WALLETS_PER_POOL) set.add(String(r.user_wallet).toLowerCase())
      walletsByPool.set(pool, set)
    }
    const specs = instances
      .map((i) => ({ poolAddress: i.poolAddress.toLowerCase(), positionManager: i.positionManager, wallets: [...(walletsByPool.get(i.poolAddress.toLowerCase()) ?? [])] }))
      .filter((s) => s.wallets.length > 0)

    const snap = await readInstanceHoldings({ client: gatewayPublicClient(cfg), instances: specs })
    return {
      source: 'chain', degraded: false, degradedReason: null,
      blockNumber: snap.blockNumber != null ? snap.blockNumber.toString() : null,
      chainId: cfg.chainId, computedAt: now, ttlMs: CHAIN_TTL_MS,
      all: toRows(rankProviders(snap.holdings)),
    }
  } catch (e) {
    log.warn('gateway.leaderboard', 'chain read failed — degrading to DB sum (flagged)', { error: String(e) })
    return { source: 'db', degraded: true, degradedReason: 'chain_read_failed', blockNumber: null, chainId: cfg.chainId, computedAt: now, ttlMs: DEGRADED_TTL_MS, all: toRows(rankProvidersFromDb(rows)) }
  }
}

export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  const me = req.nextUrl.searchParams.get('me')?.toLowerCase() || null
  const key = `chain:${cfg?.chainId ?? 'none'}`

  // ── Providers: capital at work, from CHAIN (cached) ──
  let board = cache.get(key)
  if (!board || Date.now() - board.computedAt > board.ttlMs) {
    board = await buildProvidersBoard(ctx.supabase, cfg, ctx.log)
    cache.set(key, board)
  }
  const providers = board.all

  // ── Referrers: wallets by referrals brought (tree_size), from the referral_stats view ──
  let referrers: { wallet: string; label: string; referrals: number; sharingScore: number }[] = []
  {
    const { data } = await ctx.supabase
      .from('referral_stats')
      .select('address, tree_size, sharing_score')
      .gt('tree_size', 0)
      .order('tree_size', { ascending: false })
      .limit(TOP_N)
    referrers = ((data ?? []) as { address: string; tree_size: number; sharing_score: number }[])
      .map((r) => ({ wallet: String(r.address).toLowerCase(), label: short(String(r.address)), referrals: Number(r.tree_size) || 0, sharingScore: Number(r.sharing_score) || 0 }))
  }

  // caller's own rank on each board (even if off the top-N)
  const myProvider = me ? providers.find((p) => p.wallet === me) ?? null : null
  const myReferrerIdx = me ? referrers.findIndex((p) => p.wallet === me) : -1

  const ageMs = Date.now() - board.computedAt
  return ctx.json({
    success: true,
    season: 'Season 0',
    // Provenance of the providers board — the UI should show `source` + staleness, never assume chain.
    source: board.source,
    degraded: board.degraded,
    degradedReason: board.degradedReason,
    chainId: board.chainId,
    blockNumber: board.blockNumber,
    computedAt: board.computedAt,
    ageMs,
    stale: ageMs > board.ttlMs,
    cacheTtlMs: board.ttlMs,
    providers: providers.slice(0, TOP_N),
    referrers: referrers.map((p, i) => ({ rank: i + 1, ...p })),
    me: me
      ? {
          provider: myProvider,
          referrer: myReferrerIdx >= 0 ? { rank: myReferrerIdx + 1, ...referrers[myReferrerIdx] } : null,
        }
      : null,
    updatedAt: Date.now(),
  })
})

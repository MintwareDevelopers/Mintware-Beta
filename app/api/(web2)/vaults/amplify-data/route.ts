// GET /api/vaults/amplify-data
// Feeds the vault amplification layer (live stats band + reputation leaderboard).
// Stats reflect the social_vaults grid; leaderboard falls back to the illustrative
// discovery set until real vaults seed, each row flagged real/example.
// Auth: none (public marketing surface).

import { createHandler } from '@/lib/web2/routeHandler'
import { getVaultsDiscovery, summarize } from '@/lib/vaults/discovery'
import { fetchSubgraphVaults, isSubgraphEnabled } from '@/lib/vaults/subgraph'

// Reads live Supabase aggregates + the external subgraph — must run per-request.
// Without this, Next tries to statically prerender it at build, where the Supabase
// client can't initialise (no runtime env) and the build fails.
export const dynamic = 'force-dynamic'

export const GET = createHandler(async (_req, ctx) => {
  // Seeded vaults live in social_vaults — the same source the /vaults list renders.
  // The stats band reflects the whole platform (both surfaces), in sync with the grid.
  const { data: seeded } = await ctx.supabase
    .from('social_vaults')
    .select('tvl_usdc')
  const rows = (seeded ?? []) as Array<{ tvl_usdc: number | null }>
  const seededCount = rows.length
  const seededTvl = rows.reduce((s, r) => s + (Number(r.tvl_usdc) || 0), 0)

  // Real, indexed vaults from the subgraph (empty when not wired on mainnet yet).
  const real = await fetchSubgraphVaults()
  const realTvl = real.reduce((s, v) => s + v.tvlUsd, 0)

  // Prefer the seeded social_vaults aggregate; fall back to subgraph aggregates.
  const live = seededCount > 0 ? true : (isSubgraphEnabled() && real.length > 0 && realTvl > 0)
  const stats = seededCount > 0
    ? { count: seededCount, tvlUsd: seededTvl, surfaces: 2, live }
    : { ...summarize(real), live }

  // Display leaderboard: real + illustrative, ranked by TVL desc.
  const display = (await getVaultsDiscovery())
    .slice()
    .sort((a, b) => b.tvlUsd - a.tvlUsd)

  const res = ctx.json({
    live,
    stats,
    leaderboard: display,
  })
  res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  return res
})

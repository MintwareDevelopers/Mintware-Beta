// GET /api/vaults/amplify-data
// Feeds the vault amplification layer (live stats band + reputation leaderboard).
// Real aggregates come from the subgraph; the leaderboard falls back to the
// illustrative discovery set until real vaults seed, each row flagged real/example.
// Auth: none (public marketing surface).

import { createHandler } from '@/lib/web2/routeHandler'
import { getVaultsDiscovery, summarize } from '@/lib/vaults/discovery'
import { fetchSubgraphVaults, isSubgraphEnabled } from '@/lib/vaults/subgraph'

export const GET = createHandler(async (_req, ctx) => {
  // Real, indexed vaults (empty when the subgraph isn't wired yet).
  const real = await fetchSubgraphVaults()
  const realTvl = real.reduce((s, v) => s + v.tvlUsd, 0)
  const live = isSubgraphEnabled() && real.length > 0 && realTvl > 0

  // Display leaderboard: real + illustrative, ranked by TVL desc.
  const display = (await getVaultsDiscovery())
    .slice()
    .sort((a, b) => b.tvlUsd - a.tvlUsd)

  // Stats band always reflects REAL indexed vaults (honest — shows 0/— pre-launch).
  // Illustrative data lives only in the clearly-labelled leaderboard below.
  const stats = { ...summarize(real), live }

  const res = ctx.json({
    live,
    stats,
    leaderboard: display,
  })
  res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  return res
})

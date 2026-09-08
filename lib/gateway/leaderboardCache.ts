// Module-level cache for the V1 leaderboard (per serverless instance). Lives outside the route file because
// Next.js App Router route modules may only export HTTP handlers + config — a test-only reset export there
// fails the build's route-type check. Keyed by chain so a config change never serves a stale board.
export const leaderboardCache = new Map<string, unknown>()

/** Test hook — clear the in-memory cache. */
export function resetLeaderboardCache() {
  leaderboardCache.clear()
}

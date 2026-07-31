// =============================================================================
// GET /api/agents/leaderboard         — top 100 agents by total_score
// GET /api/agents/leaderboard?limit=N — override limit (max 100)
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'

export const GET = createHandler(async (req, ctx) => {
  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit      = Math.min(parseInt(limitParam ?? '100', 10) || 100, 100)

  const { data, error } = await ctx.supabase
    .from('ai_agent_leaderboard')
    .select('*')
    .limit(limit)

  if (error) {
    ctx.log.error('agents/leaderboard', 'Failed to load leaderboard', { error: error.message })
    return ctx.json({ error: 'failed to load leaderboard' }, 500)
  }

  const res = ctx.json({ leaderboard: data ?? [], total: data?.length ?? 0 })
  res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
  return res
})

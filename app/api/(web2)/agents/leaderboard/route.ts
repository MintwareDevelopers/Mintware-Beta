// =============================================================================
// GET /api/agents/leaderboard        — top 100 agents by total_score
// GET /api/agents/leaderboard?limit= — override limit (max 100)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit      = Math.min(parseInt(limitParam ?? '100', 10) || 100, 100)

  const supabase = createSupabaseServiceClient()

  const { data, error } = await supabase
    .from('ai_agent_leaderboard')
    .select('*')
    .limit(limit)

  if (error) {
    console.error('[GET /api/agents/leaderboard]', error.message)
    return NextResponse.json({ error: 'failed to load leaderboard' }, { status: 500 })
  }

  return NextResponse.json(
    { leaderboard: data ?? [], total: data?.length ?? 0 },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
  )
}

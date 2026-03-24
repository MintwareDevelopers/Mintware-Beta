// =============================================================================
// GET /api/agents/campaigns        — list all agent volume campaigns
// GET /api/agents/campaigns?active=true — filter to active only
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function GET(req: NextRequest) {
  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'
  const supabase   = createSupabaseServiceClient()

  let q = supabase
    .from('ai_volume_campaigns')
    .select('*')
    .order('created_at', { ascending: false })

  if (activeOnly) q = q.eq('active', true)

  const { data, error } = await q
  if (error) {
    console.error('[GET /api/agents/campaigns]', error.message)
    return NextResponse.json({ error: 'failed to load campaigns' }, { status: 500 })
  }

  return NextResponse.json(
    { campaigns: data ?? [], total: data?.length ?? 0 },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
  )
}

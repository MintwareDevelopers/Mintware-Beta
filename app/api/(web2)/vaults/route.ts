// =============================================================================
// GET /api/vaults               — list all vaults (public)
// GET /api/vaults?status=active — filter by status
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status')

  const supabase = createSupabaseServiceClient()

  let q = supabase
    .from('social_vaults')
    .select(`
      *,
      current_epoch:vault_epochs(
        id, epoch_number, total_pool, bonus_pool, status, opened_at, closed_at, deadline
      )
    `)
    .order('created_at', { ascending: false })

  if (status) q = q.eq('status', status)

  const { data, error } = await q

  if (error) {
    console.error('[GET /api/vaults]', error.message)
    return NextResponse.json({ error: 'Failed to load vaults' }, { status: 500 })
  }

  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
  })
}

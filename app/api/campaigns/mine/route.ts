// =============================================================================
// GET /api/campaigns/mine?wallet=
//
// Returns all campaigns where campaigns.creator = wallet, ordered by
// created_at DESC.
//
// Requires migration 20260318000004_add_campaign_creator.sql to have been
// applied (adds campaigns.creator column).
//
// Response:
//   200 { campaigns: Campaign[] }   — may be empty array
//   400 { error: string }           — missing wallet param
//
// Auth: none — wallet address is the filter; no sensitive data exposed.
// Uses service role to bypass RLS.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'

// Validate Ethereum address: 0x + 40 hex chars
function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('wallet')

  if (!raw) {
    return NextResponse.json({ error: 'wallet param is required' }, { status: 400 })
  }
  if (!isValidAddress(raw)) {
    return NextResponse.json(
      { error: 'invalid wallet — must be 0x followed by 40 hex characters' },
      { status: 400 }
    )
  }

  const wallet = raw.toLowerCase()
  const supabase = createSupabaseServiceClient()

  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('creator', wallet)
    .order('created_at', { ascending: false })

  if (error) {
    // If creator column doesn't exist yet (migration not applied), return empty
    if (error.code === '42703') {
      return NextResponse.json({ campaigns: [] })
    }
    console.error('[campaigns/mine] query error:', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }

  return NextResponse.json({ campaigns: data ?? [] })
}

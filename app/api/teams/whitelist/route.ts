// =============================================================================
// GET /api/teams/whitelist?wallet=
//
// Returns whether the wallet is in whitelisted_teams with status='approved'.
// Used by the create-campaign flow to gate points campaigns.
//
// Response:
//   200 { whitelisted: boolean }
//   400 { error: string }
//
// Auth: none — wallet address is the filter. Uses service role to bypass RLS.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'

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

  const wallet   = raw.toLowerCase()
  const supabase = createSupabaseServiceClient()

  const { data, error } = await supabase
    .from('whitelisted_teams')
    .select('wallet')
    .eq('wallet', wallet)
    .eq('status', 'approved')
    .maybeSingle()

  if (error) {
    console.error('[teams/whitelist] query error:', error)
    return NextResponse.json({ error: 'Failed to check whitelist' }, { status: 500 })
  }

  return NextResponse.json({ whitelisted: data !== null })
}

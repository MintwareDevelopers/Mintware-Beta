import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

// ---------------------------------------------------------------------------
// Address validation
// Must be a valid Ethereum address: 0x + 40 hex chars = 42 total
// ---------------------------------------------------------------------------
function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

// GET /api/referral?address=0x...
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('address')
  if (!raw) {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }
  if (!isValidAddress(raw)) {
    return NextResponse.json(
      { error: 'invalid address — must be 0x followed by 40 hex characters' },
      { status: 400 }
    )
  }

  const address = raw.toLowerCase()
  // Service client: bypasses RLS for consistent reads from the referral_stats view.
  // referral_stats is a read-only view with no sensitive data — safe to expose publicly.
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('referral_stats')
    .select('*')
    .eq('address', address)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

// POST /api/referral
// Legacy mutation route removed in favor of POST /api/auth/connect, which
// requires a fresh wallet-signed authorization message.
export async function POST(req: NextRequest) {
  void req
  return NextResponse.json(
    { error: 'deprecated — use POST /api/auth/connect with wallet authorization' },
    { status: 410 }
  )
}

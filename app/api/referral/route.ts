import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'
import { generateRefCode } from '@/lib/referral/utils'

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
// Body: { address: string }
// Upserts a wallet_profiles row and returns the wallet's referral stats.
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const raw = (body as Record<string, unknown>)?.address
  if (!raw || typeof raw !== 'string') {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }
  if (!isValidAddress(raw)) {
    return NextResponse.json(
      { error: 'invalid address — must be 0x followed by 40 hex characters' },
      { status: 400 }
    )
  }

  const address = raw.toLowerCase()
  const supabase = createSupabaseServiceClient()
  const refCode  = generateRefCode(address)

  const { error: upsertErr } = await supabase
    .from('wallet_profiles')
    .upsert(
      { address, ref_code: refCode, last_seen_at: new Date().toISOString() },
      { onConflict: 'address' }
    )

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  const { data, error } = await supabase
    .from('referral_stats')
    .select('*')
    .eq('address', address)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 500 })
  }

  return NextResponse.json(data)
}

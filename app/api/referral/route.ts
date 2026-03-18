import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { generateRefCode } from '@/lib/referral/utils'

function makeServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

function makeAnonClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )
}

// GET /api/referral?address=0x...
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }

  const supabase = makeAnonClient()
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

// POST /api/referral/generate
// Body: { address: string }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const address = body?.address?.toLowerCase()
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }

  const supabase = makeServiceClient()
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

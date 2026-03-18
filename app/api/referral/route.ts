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
// Returns: ReferralStats (read-only, anon key fine)
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

// POST /api/referral
// Body: { address: string, pendingRef?: string | null }
// Returns: { isNew: boolean, stats: ReferralStats | null }
//
// All writes use the service role key to bypass RLS (anon key blocks INSERT/UPDATE).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const address: string | undefined = body?.address?.toLowerCase()
  const pendingRef: string | null   = body?.pendingRef ?? null

  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }

  const supabase = makeServiceClient()
  const refCode  = generateRefCode(address)

  // 1. Detect first connect (count before upsert)
  const { count } = await supabase
    .from('wallet_profiles')
    .select('address', { count: 'exact', head: true })
    .eq('address', address)
  const isNew = count === 0

  // 2. Upsert wallet profile
  const { error: upsertErr } = await supabase
    .from('wallet_profiles')
    .upsert(
      { address, ref_code: refCode, last_seen_at: new Date().toISOString() },
      { onConflict: 'address' }
    )
  if (upsertErr) {
    console.error('[api/referral] upsert error:', upsertErr.code, upsertErr.message)
    return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  // 3. Handle pending referral attribution (only on first connect)
  if (pendingRef && isNew) {
    const { data: referrerProfile } = await supabase
      .from('wallet_profiles')
      .select('address')
      .eq('ref_code', pendingRef)
      .single()

    if (referrerProfile && referrerProfile.address !== address) {
      const { error: refErr } = await supabase
        .from('referral_records')
        .upsert(
          {
            referrer: referrerProfile.address,
            referred: address,
            ref_code: pendingRef,
            status:   'pending',
          },
          { onConflict: 'referred', ignoreDuplicates: true }
        )
      if (refErr) {
        console.error('[api/referral] referral_records error:', refErr.code, refErr.message)
      }
    }
  }

  // 4. Return stats (may be null if the view hasn't populated yet for a new wallet)
  const { data: stats } = await supabase
    .from('referral_stats')
    .select('*')
    .eq('address', address)
    .single()

  return NextResponse.json({ isNew, stats: stats ?? null })
}

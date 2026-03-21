// =============================================================================
// POST /api/referral/apply
//
// Server-side referral attribution with time-gate protection.
//
// Why this exists (vs. direct Supabase insert from the client):
//   The browser Supabase client (anon key) cannot enforce server-side rules.
//   A bot could pre-generate ref codes for fresh wallets and immediately
//   insert referral_records before the referrer has been a real user for 24h.
//   Moving the insert here lets us check last_seen_at on the referrer.
//
// Time-gate rule:
//   referrer.last_seen_at must be at least 24 hours before now().
//   Referrers created less than 24h ago are rejected with 'referrer_too_new'.
//   This makes it uneconomical to farm self-referrals with fresh wallets.
//
// Body: { referred: string, ref_code: string }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { attestReferral }             from '@/lib/rewards/eas'

const TIME_GATE_MS = 24 * 60 * 60 * 1000 // 24 hours

function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  const rawReferred = b?.referred
  const refCode     = b?.ref_code

  if (!rawReferred || typeof rawReferred !== 'string') {
    return NextResponse.json({ error: 'referred address required' }, { status: 400 })
  }
  if (!isValidAddress(rawReferred)) {
    return NextResponse.json({ error: 'invalid referred address' }, { status: 400 })
  }
  if (!refCode || typeof refCode !== 'string') {
    return NextResponse.json({ error: 'ref_code required' }, { status: 400 })
  }

  const referred = rawReferred.toLowerCase()
  const supabase = createSupabaseServiceClient()

  // Look up referrer by ref_code
  const { data: referrerProfile, error: lookupErr } = await supabase
    .from('wallet_profiles')
    .select('address, last_seen_at')
    .eq('ref_code', refCode)
    .single()

  if (lookupErr || !referrerProfile) {
    // ref_code doesn't exist — not an error, just a no-op
    return NextResponse.json({ applied: false, skip_reason: 'ref_code_not_found' }, { status: 200 })
  }

  const referrer = referrerProfile.address

  // Self-referral guard
  if (referrer === referred) {
    return NextResponse.json({ applied: false, skip_reason: 'self_referral' }, { status: 200 })
  }

  // ── Time-gate: referrer must have been seen at least 24h ago ──────────────
  const lastSeen   = referrerProfile.last_seen_at
    ? new Date(referrerProfile.last_seen_at).getTime()
    : 0
  const ageMs = Date.now() - lastSeen

  if (ageMs < TIME_GATE_MS) {
    console.warn(
      `[referral/apply] referrer_too_new: ${referrer} last_seen_at=${referrerProfile.last_seen_at} ageMs=${ageMs}`
    )
    return NextResponse.json({ applied: false, skip_reason: 'referrer_too_new' }, { status: 200 })
  }

  // ── Insert referral record ────────────────────────────────────────────────
  const { error: insertErr } = await supabase
    .from('referral_records')
    .upsert(
      {
        referrer,
        referred,
        ref_code: refCode,
        status:   'pending',
      },
      { onConflict: 'referred', ignoreDuplicates: true }
    )

  if (insertErr) {
    console.error('[referral/apply] insert error:', insertErr.message)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }

  // ── Fire-and-forget: ReferralLink EAS attestation ─────────────────────────
  // Never await — EAS failure must never block or degrade the referral response.
  void attestReferral(referrer, referred, refCode as string)
    .then(async (uid) => {
      if (!uid) return
      try {
        await createSupabaseServiceClient()
          .from('eas_attestations')
          .upsert(
            {
              wallet:      referred,
              schema_name: 'ReferralLink',
              eas_uid:     uid,
              attested_at: new Date().toISOString(),
              metadata:    { referrer, ref_code: refCode },
            },
            { onConflict: 'eas_uid' }
          )
      } catch (e) { console.error('[referral/apply] EAS upsert failed:', e) }
    })
    .catch(err => console.error('[referral/apply] EAS attestation failed:', err))

  return NextResponse.json({ applied: true }, { status: 200 })
}

export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
}

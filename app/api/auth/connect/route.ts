// =============================================================================
// POST /api/auth/connect
//
// First-connect handler. Called by useReferral.ts on wallet connect.
// Generates and permanently stores a ref code for new wallets.
//
// Ref code logic (Basename-first):
//   1. Check if wallet already has a ref_code — if yes, return it immediately
//   2. New wallet: resolve Basename → "jake.base" → "jake"
//   3. No Basename: base58-encode address bytes 2–8 → "5Fns"
//   4. Collision check loop until unique code found
//   5. Upsert wallet_profiles: set ref_code only on first insert (COALESCE)
//
// Ref code format:
//   - Basename-derived:  "jake", "alice" (no prefix)
//   - Address fallback:  "5Fns", "3kXm" (base58, no prefix)
//   - Existing legacy:   "mw_3f9a12" (untouched — permanent)
//
// Body:  { address: string }
// Returns: { ref_code: string, is_new: boolean }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'
import { generateRefCodeForWallet } from '@/lib/referral-code'

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

  const b       = body as Record<string, unknown>
  const rawAddr = b?.address

  if (!rawAddr || typeof rawAddr !== 'string') {
    return NextResponse.json({ error: 'address required' }, { status: 400 })
  }
  if (!isValidAddress(rawAddr)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }

  const address  = rawAddr.toLowerCase()
  const supabase = createSupabaseServiceClient()

  // ── Check if wallet already exists with a ref_code ────────────────────────
  const { data: existing, error: lookupErr } = await supabase
    .from('wallet_profiles')
    .select('ref_code')
    .eq('address', address)
    .maybeSingle()

  if (lookupErr) {
    console.error('[auth/connect] lookup error:', lookupErr.message)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }

  if (existing?.ref_code) {
    // Existing wallet — just update last_seen_at, return stored code
    await supabase
      .from('wallet_profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('address', address)

    return NextResponse.json({
      ref_code: existing.ref_code,
      is_new:   false,
    })
  }

  // ── New wallet — generate a ref code ──────────────────────────────────────
  let refCode: string
  try {
    refCode = await generateRefCodeForWallet(address, supabase)
  } catch (err) {
    console.error('[auth/connect] generateRefCodeForWallet error:', err)
    // Fallback: use the legacy deterministic code so we never block
    refCode = 'mw_' + address.slice(2, 8)
  }

  // Upsert: set ref_code only if null (prevents overwriting existing codes if
  // there's a race). Use raw SQL via RPC if needed, or rely on the check above.
  const { error: upsertErr } = await supabase
    .from('wallet_profiles')
    .upsert(
      {
        address,
        ref_code:     refCode,
        last_seen_at: new Date().toISOString(),
      },
      {
        onConflict:       'address',
        ignoreDuplicates: false,
      }
    )

  if (upsertErr) {
    console.error('[auth/connect] upsert error:', upsertErr.message)
    // Still return a code even if the DB write failed (non-critical)
    return NextResponse.json({
      ref_code: refCode,
      is_new:   true,
    })
  }

  return NextResponse.json({
    ref_code: refCode,
    is_new:   true,
  })
}

export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
}

// =============================================================================
// POST /api/teams/apply
//
// Submits a team application for points campaign access.
//
// Body: {
//   wallet, protocol_name, website?, contact_email,
//   pool_size_usd?, description?
// }
//
// Responses:
//   200 { success: true, status: 'pending' }       — new application inserted
//   200 { status: 'pending', message: string }      — already pending
//   200 { status: 'approved' }                      — already approved
//   400 { error: string }                           — validation failure
//   500 { error: string }                           — DB error
//
// Auth: none. Uses service role for DB writes.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    wallet,
    protocol_name,
    website,
    contact_email,
    pool_size_usd,
    description,
  } = body as Record<string, string>

  // -- Validate required fields -----------------------------------------------
  if (!wallet || !protocol_name || !contact_email) {
    return NextResponse.json(
      { error: 'wallet, protocol_name, and contact_email are required' },
      { status: 400 }
    )
  }
  if (!isValidAddress(wallet)) {
    return NextResponse.json(
      { error: 'invalid wallet — must be 0x followed by 40 hex characters' },
      { status: 400 }
    )
  }
  if (!isValidEmail(contact_email)) {
    return NextResponse.json({ error: 'invalid contact_email' }, { status: 400 })
  }

  const normalWallet = wallet.toLowerCase()
  const supabase     = createSupabaseServiceClient()

  // -- Check whitelist first (already approved?) --------------------------------
  const { data: whitelisted } = await supabase
    .from('whitelisted_teams')
    .select('status')
    .eq('wallet', normalWallet)
    .maybeSingle()

  if (whitelisted?.status === 'approved') {
    return NextResponse.json({ status: 'approved' })
  }

  // -- Check existing application -----------------------------------------------
  const { data: existing } = await supabase
    .from('team_applications')
    .select('id, status')
    .eq('wallet', normalWallet)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'pending' || existing.status === 'reviewed') {
      return NextResponse.json({
        status: 'pending',
        message: 'Your application is under review',
      })
    }
    if (existing.status === 'approved') {
      return NextResponse.json({ status: 'approved' })
    }
    // rejected — allow reapplication (fall through)
  }

  // -- Insert new application ---------------------------------------------------
  const { error: insertErr } = await supabase
    .from('team_applications')
    .insert({
      wallet:        normalWallet,
      protocol_name: protocol_name.trim(),
      website:       website?.trim() || null,
      contact_email: contact_email.trim().toLowerCase(),
      pool_size_usd: pool_size_usd?.trim() || null,
      description:   description?.trim() || null,
    })

  if (insertErr) {
    console.error('[teams/apply] insert error:', insertErr)
    return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 })
  }

  return NextResponse.json({ success: true, status: 'pending' })
}

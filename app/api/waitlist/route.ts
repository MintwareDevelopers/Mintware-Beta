// =============================================================================
// POST /api/waitlist
//
// Inserts an email into the waitlist table.
// Body: { email: string }
// Response: { ok: true } | { error: string }
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  let body: { email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  const { error } = await supabase
    .from('waitlist')
    .upsert({ email, joined_at: new Date().toISOString() }, { onConflict: 'email' })

  if (error) {
    console.error('[waitlist] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

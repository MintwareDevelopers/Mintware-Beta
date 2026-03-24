// GET /api/cron/expire-proposals
//
// Cron job: mark past-validUntil proposals as 'expired'.
// Run frequently (every 15 min or every hour) — safe to re-run.
//
// Auth: Bearer CRON_SECRET
//
// Vercel cron config (vercel.json):
//   { "path": "/api/cron/expire-proposals", "schedule": "0 * * * *" }
//
// Response:
//   200 { expired: number }
//   401 Unauthorized
//   500 DB error

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createSupabaseServiceClient()
  const nowSecs  = Math.floor(Date.now() / 1000)

  const { error, count } = await supabase
    .from('vault_rebalance_proposals')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('valid_until', nowSecs)

  if (error) {
    console.error('[expire-proposals] Supabase error:', error.message)
    return NextResponse.json({ error: 'Failed to expire proposals' }, { status: 500 })
  }

  console.log(`[expire-proposals] Expired ${count ?? 0} proposals at ${new Date().toISOString()}`)
  return NextResponse.json({ expired: count ?? 0 })
}

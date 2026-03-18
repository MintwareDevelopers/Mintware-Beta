// =============================================================================
// GET /api/cron/bridge-verify
//
// Daily bridge verification cron job.
// Triggered by Vercel Cron at 00:00 UTC — configured in vercel.json:
//
//   {
//     "crons": [{
//       "path": "/api/cron/bridge-verify",
//       "schedule": "0 0 * * *"
//     }]
//   }
//
// Vercel Cron sends a GET request with the Authorization header set to the
// CRON_SECRET env var. We validate that header before running.
//
// Can also be triggered manually (curl, Postman) for testing — same auth.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { runBridgeVerifier } from '@/lib/campaigns/bridgeVerifier'

export const maxDuration = 300  // 5 min — Vercel Pro max for cron functions

export async function GET(req: NextRequest) {
  // Auth: Vercel Cron sets Authorization: Bearer <CRON_SECRET>
  // Manual invocations should pass the same header.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  } else {
    // No secret configured — only allow in development
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'CRON_SECRET env var not set — refusing to run in production without auth' },
        { status: 500 }
      )
    }
  }

  const startedAt = Date.now()
  console.log('[bridge-verify] cron started at', new Date().toISOString())

  try {
    const summary = await runBridgeVerifier()

    const durationMs = Date.now() - startedAt
    console.log('[bridge-verify] cron complete:', { ...summary, durationMs })

    return NextResponse.json({
      ok: true,
      duration_ms: durationMs,
      ...summary,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[bridge-verify] cron failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// Reject POST / other methods
export async function POST() {
  return NextResponse.json({ error: 'method not allowed — use GET' }, { status: 405 })
}

// =============================================================================
// POST /api/treasury/sweep
//
// Triggered daily by Vercel Cron (03:00 UTC — after epoch cron at 01:00).
// Also callable manually for testing: POST with Authorization header.
//
// Sweeps all accumulated ERC-20 tokens in the Mintware treasury wallet
// into native ETH on Base using LI.FI routing. Skips dust (< $1 USD).
//
// Auth: Bearer token matching CRON_SECRET env var.
//       Vercel Cron sends this automatically via vercel.json headers config.
//
// Response:
//   200 { ok: true, report: SweepReport }
//   401 Unauthorized
//   500 Sweep failed (TREASURY_PRIVATE_KEY missing or RPC error)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { runSweep } from '@/lib/treasury/sweep'

export const maxDuration = 300   // 5 min — Vercel Pro allows up to 300s for cron functions

export async function POST(req: NextRequest) {
  // ── Auth — require Bearer CRON_SECRET ───────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[sweep] Starting treasury sweep...')

  try {
    const report = await runSweep()
    console.log(
      `[sweep] Done — ${report.tokensSwapped}/${report.tokensChecked} tokens swapped`
    )
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    const message = (err as Error).message
    console.error('[sweep] Fatal error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

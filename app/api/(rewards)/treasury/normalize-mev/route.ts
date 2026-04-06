// =============================================================================
// GET /api/treasury/normalize-mev  (also accepts POST for manual runs)
//
// Triggered daily by Vercel Cron (03:00 UTC) via GET.
// Also callable manually: POST with Authorization header.
//
// Flow:
//   1. Read staged MEV balances in the treasury wallet
//   2. Swap non-USDC assets into USDC using LI.FI
//   3. Deposit resulting USDC into FeeVault via receiveFees("mev-normalized")
//
// Auth: Bearer token matching CRON_SECRET env var.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { runNormalizeMev } from '@/lib/rewards/treasury/sweep'

export const maxDuration = 300

async function handle(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[normalize-mev] Starting MEV normalization...')

  try {
    const report = await runNormalizeMev()
    console.log(
      `[normalize-mev] Done — ${report.tokensNormalized}/${report.tokensChecked} tokens normalized ` +
      `total_usdc=${report.totalUsdcDeposited}`
    )
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    const message = (err as Error).message
    console.error('[normalize-mev] Fatal error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Vercel crons invoke via GET — manual calls may use POST
export const GET  = handle
export const POST = handle

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { upsertTradeSignals } from '@/lib/rewards/universal/store'

export const dynamic = 'force-dynamic'

const tradeSignalSchema = z.object({
  chain_id: z.number().int().nonnegative(),
  pool_id: z.string().min(1),
  tx_hash: z.string().min(1),
  log_index: z.number().int().nonnegative(),
  block_number: z.number().int().nonnegative(),
  swapper: z.string().min(1),
  referrer: z.string().min(1).nullable().optional(),
  amount_in: z.union([z.string(), z.bigint()]),
  amount_out: z.union([z.string(), z.bigint()]),
  dynamic_fee_bps: z.number().int().nonnegative(),
  capture_amount: z.union([z.string(), z.bigint()]),
  tick_after: z.number().int(),
  pyth_timestamp: z.number().int().nonnegative(),
  hook_data: z.string().nullable().optional(),
  observed_at: z.string().datetime().nullable().optional(),
})

const requestSchema = z.object({
  signals: z.array(tradeSignalSchema).min(1).max(500),
})

function authorize(req: NextRequest): NextResponse | null {
  const secret = process.env.TRADE_SIGNAL_INGEST_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    return null
  }

  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'TRADE_SIGNAL_INGEST_SECRET not set — refusing to ingest outside local development' },
      { status: 500 }
    )
  }

  return null
}

export async function POST(req: NextRequest) {
  const authFailure = authorize(req)
  if (authFailure) return authFailure

  try {
    const body = await req.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid payload', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const rows = await upsertTradeSignals(parsed.data.signals)

    return NextResponse.json({
      ok: true,
      ingested: rows.length,
      first_id: rows[0]?.id ?? null,
      last_id: rows.at(-1)?.id ?? null,
    })
  } catch (error) {
    console.error('[universal-trade-signal] ingestion failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

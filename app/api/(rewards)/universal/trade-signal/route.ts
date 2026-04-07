// POST /api/universal/trade-signal
// Ingests trade signals from the MWSocialHook V4 indexer.
// Auth: Bearer TRADE_SIGNAL_INGEST_SECRET

import { createHandler } from '@/lib/web2/routeHandler'
import { TRADE_SIGNAL_INGEST_SECRET } from '@/lib/constants'
import { z } from 'zod'
import { upsertTradeSignals } from '@/lib/rewards/universal/store'

export const dynamic = 'force-dynamic'

const tradeSignalSchema = z.object({
  chain_id:        z.number().int().nonnegative(),
  pool_id:         z.string().min(1),
  tx_hash:         z.string().min(1),
  log_index:       z.number().int().nonnegative(),
  block_number:    z.number().int().nonnegative(),
  swapper:         z.string().min(1),
  referrer:        z.string().min(1).nullable().optional(),
  amount_in:       z.union([z.string(), z.bigint()]),
  amount_out:      z.union([z.string(), z.bigint()]),
  dynamic_fee_bps: z.number().int().nonnegative(),
  capture_amount:  z.union([z.string(), z.bigint()]),
  tick_after:      z.number().int(),
  pyth_timestamp:  z.number().int().nonnegative(),
  hook_data:       z.string().nullable().optional(),
  observed_at:     z.string().datetime().nullable().optional(),
})

const requestSchema = z.object({
  signals: z.array(tradeSignalSchema).min(1).max(500),
})

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'invalid json' }, 400) }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return ctx.json({ error: 'invalid payload', issues: parsed.error.issues }, 400)
  }

  const rows = await upsertTradeSignals(parsed.data.signals)
  ctx.log.info('trade-signal', 'Ingested signals', { count: rows.length })

  return ctx.json({ ok: true, ingested: rows.length, first_id: rows[0]?.id ?? null, last_id: rows.at(-1)?.id ?? null })
}, { auth: 'bearer-token', bearerSecret: TRADE_SIGNAL_INGEST_SECRET })

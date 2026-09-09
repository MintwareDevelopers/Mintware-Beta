// GET /api/gateway/fee-reconciliation
//
// V1-07 (independent Codex audit, round-4, 2026-09-09): "paired-token fees are never converted... until
// then expose unconverted income and describe the limitation accurately." The raw harvested paired-token
// fee is already durably tracked per Harvested log (lib/gateway/ledger.ts#indexHarvestLogs writes it into
// `gateway_harvest_logs.paired_fees_atomic`, migration 20260908000002) — but nothing read that data back
// out through any route or UI. This is that read: an operator-only diagnostic listing, per (chain,
// position manager), how much paired-token fee income has accumulated UNCONVERTED (gross_paired_atomic),
// alongside the quote-side reconciliation the same view already computes.
//
// Read-only, no on-chain call, no fund movement. Bearer-gated (ADMIN_SECRET) — this is operational/
// financial reconciliation data, not a public UI surface (contrast with the public `alerts` route).

import { createHandler } from '@/lib/web2/routeHandler'
import { ADMIN_SECRET } from '@/lib/constants'

export const dynamic = 'force-dynamic'

type ReconciliationRow = {
  chain_id: number
  position_manager: string
  harvest_logs: number
  gross_quote_atomic: string
  gross_paired_atomic: string
  skimmed_atomic: string
  credited_atomic: string
  unallocated_atomic: string
  pending_net_atomic: string
  restaked_net_atomic: string
  paid_atomic: string
  expected_seat_quote_atomic: string
}

export const GET = createHandler(async (_req, ctx) => {
  const { data, error } = await ctx.supabase
    .from('gateway_fee_ledger_reconciliation')
    .select('*')
    .order('gross_paired_atomic', { ascending: false })
  if (error) {
    // The view lives in a migration that may not have run yet on this environment — fail closed with a
    // clear reason rather than a raw 500, matching the project's other "migration not applied" postures.
    return ctx.json({ success: false, error: 'reconciliation_unavailable', detail: error.message }, 503)
  }
  return ctx.json({
    success: true,
    pools: ((data ?? []) as ReconciliationRow[]).map((r) => ({
      chainId: r.chain_id,
      positionManager: r.position_manager,
      harvestLogs: r.harvest_logs,
      grossQuoteAtomic: r.gross_quote_atomic,
      // The unconverted paired-token fee — this is the number V1-07 asked to be made visible. Denominated
      // in the PAIRED token's own atomic units (not quote, not comparable across pools with different
      // paired-token decimals) — never sum this field across rows.
      grossPairedAtomic: r.gross_paired_atomic,
      skimmedAtomic: r.skimmed_atomic,
      creditedAtomic: r.credited_atomic,
      unallocatedAtomic: r.unallocated_atomic,
      pendingNetAtomic: r.pending_net_atomic,
      restakedNetAtomic: r.restaked_net_atomic,
      paidAtomic: r.paid_atomic,
      expectedSeatQuoteAtomic: r.expected_seat_quote_atomic,
    })),
    note: 'grossPairedAtomic is harvested but NOT converted to quote (routerSwap.ts has no wired executor yet) — it sits in the harvest recipient wallet, outside compounded NAV, until a real swap path is implemented.',
  })
}, { auth: 'bearer-token', bearerSecret: ADMIN_SECRET })

// POST /api/cron/card-buffer-refill
// Auth: Bearer CRON_SECRET
//
// Steady-state backstop for the card spend buffer (docs/developers/card-spend-buffer-spec.md §5.3):
// scans every auto-refill-enabled buffer, reconciles its cached balance against on-chain, and tops it
// back toward target through the shared refill core (lib/org/bufferRefill.refillCardBuffer, which runs
// the refill-rate breaker + submits refillBuffer via the oracle signer). The FAST path is the reactive
// capture-webhook; this cron catches anything the reactive path missed and does adaptive steady-state
// top-ups.
//
// FAIL-CLOSED + dark-launched: no-ops with `{enabled:false}` until CARD_BUFFER_REFILL_ENABLED==='true'.
// Not yet wired into vercel.json — it is bearer-callable (manual / external scheduler) meanwhile, so a
// dark feature never consumes a Hobby cron slot or risks blocking a deploy. Add the schedule when the
// feature goes live.

import { createHandler } from '@/lib/web2/routeHandler'
import { syncBufferBalance } from '@/lib/org/bufferMonitor'
import { refillCardBuffer } from '@/lib/org/bufferRefill'
import { tuneBufferSizing } from '@/lib/org/bufferTuner'

export const dynamic = 'force-dynamic'

const MAX_PER_RUN = 200

/** The org_cards join is a to-one relation, so supabase returns it as an object (older clients: a
 *  1-element array). Read org_id defensively across both shapes. */
function orgIdOf(row: { org_cards?: unknown }): string | null {
  const j = row.org_cards
  const obj = Array.isArray(j) ? j[0] : j
  const id = (obj as { org_id?: unknown } | undefined)?.org_id
  return typeof id === 'string' ? id : null
}

export const POST = createHandler(async (_req, ctx) => {
  if (process.env.CARD_BUFFER_REFILL_ENABLED !== 'true') {
    return ctx.json({ enabled: false, scanned: 0, refilled: 0, skipped: 0, failed: 0 })
  }

  const { data: buffers, error } = await ctx.supabase
    .from('card_spend_buffers')
    .select('org_card_id, org_cards!inner(org_id)')
    .eq('auto_refill_enabled', true)
    .eq('breaker_open', false)
    .limit(MAX_PER_RUN)
  if (error) {
    ctx.log.error('cron.buffer', 'buffer scan failed', { error: error.message })
    return ctx.json({ enabled: true, error: 'scan_failed' }, 502)
  }

  const rows = buffers ?? []
  let refilled = 0, skipped = 0, failed = 0
  const refilledCards: string[] = []

  for (const row of rows) {
    const orgId = orgIdOf(row as { org_cards?: unknown })
    const orgCardId = (row as { org_card_id: string }).org_card_id
    if (!orgId) { failed++; continue }

    // Belt-and-suspenders (re-audit R1): release holds for buffer auths that never settled past the
    // ~7-day card auth-hold window — a missed reversal/void webhook — so a stuck reservation can't
    // slowly starve a funded buffer.
    await ctx.supabase.rpc('reconcile_card_reservations', {
      p_org_card_id: orgCardId,
      p_stale_before: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    })

    // Adaptively re-size the target from the member's real spend (§5.3), then reconcile the cached
    // balance before deciding the refill. Both are best-effort — a failure falls back to stored values.
    await tuneBufferSizing({ supabase: ctx.supabase, orgCardId, log: ctx.log })
    await syncBufferBalance({ supabase: ctx.supabase, orgId, orgCardId, log: ctx.log })

    const res = await refillCardBuffer({ supabase: ctx.supabase, orgId, orgCardId, trigger: 'cron', log: ctx.log })
    if (res.ok) { refilled++; refilledCards.push(orgCardId) }
    else if (res.reason === 'at_target' || res.reason === 'rate_capped') skipped++
    else failed++
  }

  ctx.log.info('cron.buffer', 'card buffer refill sweep', { scanned: rows.length, refilled, skipped, failed })
  return ctx.json({ enabled: true, scanned: rows.length, refilled, skipped, failed, refilledCards })
}, { auth: 'bearer-token' })

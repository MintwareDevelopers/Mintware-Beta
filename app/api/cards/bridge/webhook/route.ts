// Bridge card webhook — the "spend, still earning" reconciler for the Bridge rail.
//
// Unlike the Lithic ASA route, we do NOT authorize here (Bridge does, at its own pull time). This route
// only reacts to POSTED movements: a spend resyncs the cached buffer balance from chain and tops it back
// up (Gateway.refillBuffer redeeming a vault slice); a refund resyncs only. All the decision logic is in
// lib/org/bridgeReconcile.ts; verification/normalization in lib/cards/bridgeClient.ts.
//
// Replay defense (audit): verifyBridgeWebhook rejects events outside a freshness window; this route
// additionally dedupes on the event id (bridge_webhook_events) so a replay INSIDE the window is a no-op.
//
// Fail-closed + ack-200: 503 when the rail/secret is unconfigured, 401 on a bad signature, 400 on a
// stale (replayed/old) timestamp, 200 otherwise (so Bridge/Stripe doesn't retry-storm) — a skipped
// refill just stays skipped, and any downstream error is caught and still acked 200. Manual auth
// (Bridge signs with its own Stripe-style scheme), same category as the Lithic webhooks.

import type { NextRequest } from 'next/server'
import { createPublicClient, http } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { bridgeCardsEnabled } from '@/lib/cards/bridge'
import { bufferSweepEnabled } from '@/lib/cards/sweep'
import { normalizeBridgeEvent, verifyBridgeWebhook } from '@/lib/cards/bridgeClient'
import { reconcileBridgeEvent } from '@/lib/org/bridgeReconcile'
import { sweepBufferToVault } from '@/lib/org/bridgeSweep'
import { privySignerFromEnv } from '@/lib/org/walletSigner'
import { syncBufferBalance } from '@/lib/org/bufferMonitor'
import { refillCardBuffer } from '@/lib/org/bufferRefill'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const POST = createHandler(async (req: NextRequest, ctx) => {
  if (!bridgeCardsEnabled()) return ctx.json({ error: 'bridge_rail_disabled' }, 503)

  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k] = v })

  const verified = verifyBridgeWebhook(rawBody, headers)
  if (!verified.ok) {
    if (verified.reason === 'unconfigured') return ctx.json({ error: 'bridge_webhook_unconfigured' }, 503)
    if (verified.reason === 'malformed') return ctx.json({ ok: true, ignored: true }, 200)
    if (verified.reason === 'stale') return ctx.json({ error: 'stale_event' }, 400) // replay / too old
    ctx.log.warn('cards.bridge', 'webhook signature verification failed')
    return ctx.json({ error: 'invalid_signature' }, 401)
  }

  const parsed = normalizeBridgeEvent(verified.event)
  if (parsed.kind === 'ignore' || !parsed.providerCardId) {
    return ctx.json({ ok: true, ignored: true }, 200)
  }

  // Everything past here is best-effort and MUST still ack 200 (avoid Bridge retry-storms).
  try {
    // Idempotency: record the event id first; a duplicate delivery short-circuits as a no-op.
    if (parsed.eventId) {
      const { error: dupErr } = await ctx.supabase.from('bridge_webhook_events').insert({ event_id: parsed.eventId })
      if (dupErr) {
        if ((dupErr as { code?: string }).code === '23505') {
          return ctx.json({ ok: true, ignored: true, reason: 'replay' }, 200)
        }
        // a non-duplicate insert error (infra) — log and proceed; the reconcile is still safe to run.
        ctx.log.warn('cards.bridge', 'event dedup insert failed (proceeding)', { code: (dupErr as { code?: string }).code })
      }
    }

    // Resolve the Bridge card id back to one of our cards.
    const { data: card } = await ctx.supabase
      .from('org_cards')
      .select('id, org_id')
      .eq('bridge_card_id', parsed.providerCardId)
      .maybeSingle()
    if (!card) {
      ctx.log.info('cards.bridge', 'event for an unknown card — ignored', { providerCardId: parsed.providerCardId })
      return ctx.json({ ok: true, ignored: true, reason: 'unknown_card' }, 200)
    }

    const result = await reconcileBridgeEvent(
      { kind: parsed.kind, orgCardId: card.id, amountAtomic: parsed.amountAtomic, eventId: parsed.eventId },
      {
        syncBuffer: async (orgCardId) => {
          const s = await syncBufferBalance({ supabase: ctx.supabase, orgId: card.org_id, orgCardId, log: ctx.log })
          return { ok: s.ok }
        },
        refill: async (orgCardId) => {
          const r = await refillCardBuffer({ supabase: ctx.supabase, orgId: card.org_id, orgCardId, trigger: 'reactive', log: ctx.log })
          if (!r.ok && r.reason === 'disabled') {
            // rail is on but refill is off: the buffer will drain and never top up → eventual silent
            // declines. Surface it loudly so the misconfiguration is visible.
            ctx.log.warn('cards.bridge', 'Bridge spend but refill DISABLED — buffer will not top up', { orgCardId })
          }
          return r.ok ? { ok: true } : { ok: false, reason: r.reason }
        },
        // Deploy-gated: skims a refund's surplus back into the vault. Any missing piece (flag off, no
        // Privy signer, no target) is a clean skip — the surplus just stays in the buffer (the pre-sweep
        // behavior). Only runs on a refund, so the extra reads/signer are off the spend hot path.
        sweep: async (orgCardId) => {
          if (!bufferSweepEnabled()) return { ok: false, reason: 'disabled' }
          const usdcAddress = process.env.BRIDGE_USDC_ADDRESS
          if (!usdcAddress) return { ok: false, reason: 'no_usdc' }
          const [{ data: c }, { data: o }, { data: b }] = await Promise.all([
            ctx.supabase.from('org_cards').select('member_wallet').eq('id', orgCardId).maybeSingle(),
            ctx.supabase.from('orgs').select('treasury_vault_address, treasury_chain_id').eq('id', card.org_id).maybeSingle(),
            ctx.supabase.from('card_spend_buffers')
              .select('buffer_balance_atomic, reserved_atomic, buffer_target_atomic, privy_wallet_id')
              .eq('org_card_id', orgCardId).maybeSingle(),
          ])
          if (!c?.member_wallet || !o?.treasury_vault_address || !o.treasury_chain_id || !b?.privy_wallet_id) {
            return { ok: false, reason: 'unconfigured' }
          }
          const signer = privySignerFromEnv(b.privy_wallet_id, o.treasury_chain_id)
          if (!signer) return { ok: false, reason: 'signer' }
          const rpcUrl = rpcForChain(o.treasury_chain_id)
          const publicClient = rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : null
          const available = (() => { try { return BigInt(b.buffer_balance_atomic) - BigInt(b.reserved_atomic ?? 0) } catch { return 0n } })()
          const target = (() => { try { return BigInt(b.buffer_target_atomic) } catch { return 0n } })()
          const res = await sweepBufferToVault({
            usdcAddress,
            vaultAddress: o.treasury_vault_address,
            member: c.member_wallet,
            availableAtomic: available,
            targetAtomic: target,
            signer,
            confirm: publicClient
              ? async (hash) => ({ success: (await publicClient.waitForTransactionReceipt({ hash })).status === 'success' })
              : undefined,
          })
          return res.ok ? { ok: true } : { ok: false, reason: res.reason }
        },
        log: (m, meta) => ctx.log.info('cards.bridge', m, meta),
      },
    )
    return ctx.json({ ok: true, ...result }, 200)
  } catch (e) {
    // Never surface a 500 to Bridge (would retry-storm the same event); ack and log.
    ctx.log.error('cards.bridge', 'webhook processing failed (acked to avoid retry-storm)', {
      error: e instanceof Error ? e.message : String(e),
    })
    return ctx.json({ ok: true, error: 'processing_failed' }, 200)
  }
})

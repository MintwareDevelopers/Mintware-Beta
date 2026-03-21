// =============================================================================
// POST /api/campaigns/swap-event
//
// Receives swap completion data and triggers the campaign attribution engine.
//
// Called from two sources:
//   1. MintwareSwap.tsx (LI.FI RouteExecutionCompleted event) — no campaign_id
//   2. Legacy / Molten callback — includes campaign_id explicitly
//
// When campaign_id is absent:
//   Looks up all 'live' campaigns the wallet is participating in, then calls
//   processSwapEvent for each. The tx_hash dedup in swapHook.ts prevents
//   double-crediting if this route is called more than once for the same tx.
//
// When campaign_id is present:
//   Calls processSwapEvent once (original behavior, unchanged).
//
// Security: Protected by optional SWAP_WEBHOOK_SECRET env var.
//   For client-side LI.FI calls, leave SWAP_WEBHOOK_SECRET unset.
//   For Molten's server-side callback, set SWAP_WEBHOOK_SECRET.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { processSwapEvent } from '@/lib/campaigns/swapHook'
import { createSupabaseServiceClient } from '@/lib/supabase'
import { attestSwap } from '@/lib/eas'
import type { SwapEvent } from '@/lib/campaigns/types'

// ---------------------------------------------------------------------------
// Request shape
// campaign_id is optional — when absent the server resolves active campaigns
// ---------------------------------------------------------------------------
interface SwapEventPayload {
  tx_hash: string
  wallet: string
  campaign_id?: string   // optional — API resolves active campaigns if absent
  token_in: string
  token_out: string
  amount_usd: number
  chain?: string         // informational — not part of SwapEvent, accepted for LI.FI compat
  timestamp?: string     // ISO 8601 — defaults to now() if not provided
}

function validatePayload(body: unknown): body is SwapEventPayload {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.tx_hash === 'string' && b.tx_hash.length > 0 &&
    typeof b.wallet === 'string' && b.wallet.startsWith('0x') &&
    // campaign_id optional — validated if present
    (b.campaign_id === undefined || (typeof b.campaign_id === 'string' && b.campaign_id.length > 0)) &&
    typeof b.token_in === 'string' &&
    typeof b.token_out === 'string' &&
    typeof b.amount_usd === 'number' && b.amount_usd > 0
  )
}

export async function POST(req: NextRequest) {
  // Simple shared-secret auth — only enforced when SWAP_WEBHOOK_SECRET is set
  // (Molten server-side webhook). LI.FI client-side calls run without the secret.
  const secret = process.env.SWAP_WEBHOOK_SECRET
  if (secret) {
    const authHeader = req.headers.get('x-webhook-secret')
    if (authHeader !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!validatePayload(body)) {
    return NextResponse.json(
      {
        error: 'invalid payload',
        required: ['tx_hash', 'wallet', 'token_in', 'token_out', 'amount_usd'],
        optional: ['campaign_id', 'chain', 'timestamp'],
      },
      { status: 422 }
    )
  }

  // ---------------------------------------------------------------------------
  // Route A: campaign_id provided — single attribution (original behaviour)
  // ---------------------------------------------------------------------------
  if (body.campaign_id) {
    const event: SwapEvent = {
      tx_hash:     body.tx_hash,
      wallet:      body.wallet,
      campaign_id: body.campaign_id,
      token_in:    body.token_in,
      token_out:   body.token_out,
      amount_usd:  body.amount_usd,
      timestamp:   body.timestamp ?? new Date().toISOString(),
    }

    try {
      const result = await processSwapEvent(event)

      if (!result.credited) {
        return NextResponse.json(
          { credited: false, skip_reason: result.skip_reason },
          { status: 200 }
        )
      }

      // Fire-and-forget: SwapActivity EAS attestation — never blocks the response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feeVerifiedA = (result as any).fee_verified ?? false
      // Derive chain IDs from body.chain if provided, default to Base
      const _CHAIN_TO_ID: Record<string, number> = {
        base: 8453, base_sepolia: 84532, ethereum: 1, eth: 1,
        bsc: 56, bnb: 56, arbitrum: 42161, optimism: 10, coredao: 1116, core_dao: 1116,
      }
      const _chainId = body.chain ? (_CHAIN_TO_ID[body.chain.toLowerCase()] ?? 8453) : 8453
      void attestSwap(event.wallet, {
        txHash:      event.tx_hash,
        fromChain:   _chainId,
        toChain:     _chainId,
        fromToken:   event.token_in  as `0x${string}`,
        toToken:     event.token_out as `0x${string}`,
        amountIn:    BigInt(Math.round(event.amount_usd * 1e6)),
        feeVerified: feeVerifiedA,
        campaignId:  event.campaign_id,
      })
        .then(async (uid) => {
          if (!uid) return
          try {
            await createSupabaseServiceClient()
              .from('eas_attestations')
              .upsert(
                {
                  wallet:      event.wallet.toLowerCase(),
                  schema_name: 'SwapActivity',
                  eas_uid:     uid,
                  attested_at: new Date().toISOString(),
                  metadata:    { tx_hash: event.tx_hash, campaign_id: event.campaign_id },
                },
                { onConflict: 'eas_uid' }
              )
          } catch (e) { console.error('[swap-event] EAS upsert error:', e) }
        })
        .catch(err => console.error('[swap-event] EAS attestation error:', err))

      return NextResponse.json(result, { status: 200 })
    } catch (err) {
      console.error('[swap-event] unhandled error:', err)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
  }

  // ---------------------------------------------------------------------------
  // Route B: campaign_id absent — resolve all live campaigns the wallet is in
  //
  // Query participants joined with campaigns (status='live').
  // Run processSwapEvent for each active campaign.
  // Idempotency is guaranteed by swapHook.ts tx_hash + wallet + action dedup.
  // ---------------------------------------------------------------------------
  const walletLower = body.wallet.toLowerCase()

  let participationRows: Array<{ campaign_id: string }> = []

  try {
    const supabase = createSupabaseServiceClient()

    // participants → campaigns join. We fetch all and filter in JS to avoid
    // relying on PostgREST embedded-filter syntax across different Supabase versions.
    const { data, error } = await supabase
      .from('participants')
      .select('campaign_id, campaigns!inner(status)')
      .eq('wallet', walletLower)

    if (error) {
      console.error('[swap-event] participants lookup failed:', error.message)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }

    // Filter to live campaigns only
    participationRows = (data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((row: any) => {
        const campaignData = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns
        return campaignData?.status === 'live'
      })
      .map((row: { campaign_id: string }) => ({ campaign_id: row.campaign_id }))
  } catch (err) {
    console.error('[swap-event] DB error during participant lookup:', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }

  if (participationRows.length === 0) {
    // Wallet is not participating in any live campaign — not an error
    return NextResponse.json(
      { credited: false, skip_reason: 'wallet_not_participant' },
      { status: 200 }
    )
  }

  // Run attribution for each active campaign
  const results = []

  for (const { campaign_id } of participationRows) {
    const event: SwapEvent = {
      tx_hash:     body.tx_hash,
      wallet:      body.wallet,
      campaign_id,
      token_in:    body.token_in,
      token_out:   body.token_out,
      amount_usd:  body.amount_usd,
      timestamp:   body.timestamp ?? new Date().toISOString(),
    }

    try {
      const result = await processSwapEvent(event)
      results.push({ campaign_id, ...result })

      // Fire-and-forget EAS attestation if credited
      if (result.credited) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const feeVerifiedB = (result as any).fee_verified ?? false
        const _CHAIN_TO_ID_B: Record<string, number> = {
          base: 8453, base_sepolia: 84532, ethereum: 1, eth: 1,
          bsc: 56, bnb: 56, arbitrum: 42161, optimism: 10, coredao: 1116, core_dao: 1116,
        }
        const _chainIdB = body.chain ? (_CHAIN_TO_ID_B[body.chain.toLowerCase()] ?? 8453) : 8453
        void attestSwap(event.wallet, {
          txHash:      event.tx_hash,
          fromChain:   _chainIdB,
          toChain:     _chainIdB,
          fromToken:   event.token_in  as `0x${string}`,
          toToken:     event.token_out as `0x${string}`,
          amountIn:    BigInt(Math.round(event.amount_usd * 1e6)),
          feeVerified: feeVerifiedB,
          campaignId:  campaign_id,
        })
          .then(async (uid) => {
            if (!uid) return
            try {
              await createSupabaseServiceClient()
                .from('eas_attestations')
                .upsert(
                  {
                    wallet:      event.wallet.toLowerCase(),
                    schema_name: 'SwapActivity',
                    eas_uid:     uid,
                    attested_at: new Date().toISOString(),
                    metadata:    { tx_hash: event.tx_hash, campaign_id },
                  },
                  { onConflict: 'eas_uid' }
                )
            } catch (e) { console.error('[swap-event] EAS upsert error:', e) }
          })
          .catch(err => console.error('[swap-event] EAS attestation error:', err))
      }
    } catch (err) {
      console.error(`[swap-event] processSwapEvent error for campaign ${campaign_id}:`, err)
      results.push({ campaign_id, credited: false, skip_reason: 'db_error' as const })
    }
  }

  const anyCredited = results.some((r) => r.credited)

  return NextResponse.json(
    { credited: anyCredited, results },
    { status: 200 }
  )
}

// Reject non-POST methods
export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
}

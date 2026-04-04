// =============================================================================
// POST /api/campaigns/sol-swap-event
//
// Solana counterpart to POST /api/campaigns/swap-event.
//
// Receives a completed Jupiter/Raydium/Orca swap and credits campaign points.
//
// Differences from the EVM route:
//   • Accepts `tx_signature` (base58, 87–88 chars) instead of `tx_hash`
//   • Accepts Solana wallet addresses (base58, not 0x-prefixed)
//   • Calls verifySolanaTx() for on-chain verification
//   • EAS attestation skipped — EAS is EVM-only in Phase 1
//   • No SWAP_WEBHOOK_SECRET guard — calls come from the client-side Jupiter
//     Terminal onSuccess callback, same as LI.FI calls to the EVM route
//
// Idempotency: tx_signature is stored as tx_hash in pending_rewards.
// The unique index (campaign_id, tx_hash, reward_type) prevents double-credit.
//
// When campaign_id is absent:
//   Resolves all live campaigns the wallet is participating in (same as EVM route).
// When campaign_id is present:
//   Calls processSwapEvent once.
//
// Security:
//   • verifySolanaTx confirms: tx exists + confirmed, no on-chain error,
//     fee payer matches wallet, ≥1 known DEX program in accountKeys.
//   • Fails open on RPC errors (rpcError: true) — never blocks legitimate users.
//   • Rate-limited to 10 req/min per IP by middleware.ts.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { processSwapEvent }       from '@/lib/rewards/swapHook'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { solanaEnabled } from '@/lib/web3/featureFlags'
import { verifySolanaTx }         from '@/lib/web3/verifySolanaTx'
import type { SwapEvent }         from '@/lib/rewards/types'
import { SOLANA_SERVER_RPC_URL } from '@/config/solana'

// ---------------------------------------------------------------------------
// Solana address regex — base58, 32–44 chars, case-sensitive
// ---------------------------------------------------------------------------
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------
interface SolSwapEventPayload {
  tx_signature: string    // Base58 Solana transaction signature (87–88 chars)
  wallet:       string    // Solana base58 wallet address (fee payer)
  campaign_id?: string    // Optional — API resolves active campaigns if absent
  token_in:     string    // e.g. "SOL", "So11111111111111111111111111111111111111112"
  token_out:    string    // e.g. "USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  amount_usd:   number    // Swap value in USD
  timestamp?:   string    // ISO 8601 — defaults to now() if not provided
}

function validatePayload(body: unknown): body is SolSwapEventPayload {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.tx_signature === 'string'  && b.tx_signature.length >= 80 &&
    typeof b.wallet       === 'string'  && SOLANA_RE.test(b.wallet) &&
    (b.campaign_id === undefined || (typeof b.campaign_id === 'string' && b.campaign_id.length > 0)) &&
    typeof b.token_in     === 'string'  && b.token_in.length  > 0 &&
    typeof b.token_out    === 'string'  && b.token_out.length > 0 &&
    typeof b.amount_usd   === 'number'  && b.amount_usd > 0
  )
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  if (!solanaEnabled) {
    return NextResponse.json({ credited: false, skip_reason: 'solana_swaps_paused' }, { status: 410 })
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
        error:    'invalid payload',
        required: ['tx_signature', 'wallet', 'token_in', 'token_out', 'amount_usd'],
        optional: ['campaign_id', 'timestamp'],
        notes: {
          tx_signature: 'Base58 Solana transaction signature (87–88 chars)',
          wallet:       'Solana base58 public key (fee payer of the swap)',
        },
      },
      { status: 422 }
    )
  }

  // ---------------------------------------------------------------------------
  // On-chain verification — verifySolanaTx checks:
  //   1. Signature format valid
  //   2. Tx exists and is confirmed (no meta.err)
  //   3. Fee payer (accountKeys[0]) matches claimed wallet
  //   4. At least one known DEX program in accountKeys
  //
  // Fail-open on RPC error (rpcError: true) — never block legitimate users.
  // ---------------------------------------------------------------------------
  const verification = await verifySolanaTx(
    body.tx_signature,
    body.wallet,
    SOLANA_SERVER_RPC_URL
  )

  if (!verification.valid) {
    return NextResponse.json(
      {
        credited:    false,
        skip_reason: verification.error ?? 'tx_invalid',
        rpc_error:   verification.rpcError,
      },
      { status: 200 }
    )
  }

  // Use tx_signature as the dedup key (stored as tx_hash in pending_rewards)
  const txKey    = body.tx_signature
  const wallet   = body.wallet          // Solana addresses are case-sensitive — no toLowerCase
  const timestamp = body.timestamp ?? new Date().toISOString()

  // ---------------------------------------------------------------------------
  // Route A: campaign_id provided — single attribution
  // ---------------------------------------------------------------------------
  if (body.campaign_id) {
    const event: SwapEvent = {
      tx_hash:     txKey,
      wallet,
      campaign_id: body.campaign_id,
      token_in:    body.token_in,
      token_out:   body.token_out,
      amount_usd:  body.amount_usd,
      timestamp,
    }

    try {
      const result = await processSwapEvent(event)
      return NextResponse.json(result, { status: 200 })
    } catch (err) {
      console.error('[sol-swap-event] unhandled error:', err)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
  }

  // ---------------------------------------------------------------------------
  // Route B: campaign_id absent — resolve all live campaigns the wallet is in
  // ---------------------------------------------------------------------------
  let participationRows: Array<{ campaign_id: string }> = []

  try {
    const supabase = createSupabaseServiceClient()

    const { data, error } = await supabase
      .from('participants')
      .select('campaign_id, campaigns!inner(status)')
      .eq('wallet', wallet)

    if (error) {
      console.error('[sol-swap-event] participants lookup failed:', error.message)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }

    participationRows = (data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((row: any) => {
        const campaignData = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns
        return campaignData?.status === 'live'
      })
      .map((row: { campaign_id: string }) => ({ campaign_id: row.campaign_id }))
  } catch (err) {
    console.error('[sol-swap-event] DB error during participant lookup:', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }

  if (participationRows.length === 0) {
    return NextResponse.json(
      { credited: false, skip_reason: 'wallet_not_participant' },
      { status: 200 }
    )
  }

  const results = []

  for (const { campaign_id } of participationRows) {
    const event: SwapEvent = {
      tx_hash:     txKey,
      wallet,
      campaign_id,
      token_in:    body.token_in,
      token_out:   body.token_out,
      amount_usd:  body.amount_usd,
      timestamp,
    }

    try {
      const result = await processSwapEvent(event)
      results.push({ campaign_id, ...result })
    } catch (err) {
      console.error(`[sol-swap-event] processSwapEvent error for campaign ${campaign_id}:`, err)
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
  if (!solanaEnabled) {
    return NextResponse.json({ error: 'solana_swaps_paused' }, { status: 410 })
  }

  return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
}

// =============================================================================
// GET /api/claim/sol?campaign_id=&epoch_number=&wallet=
//
// Phase 7 — Returns oracle signature + Merkle proof for a Solana claim.
//
// The client (ClaimCard Solana path) calls this to get everything needed
// to construct the Ed25519SigVerify + Anchor program `claim` transaction.
//
// Response shape:
// {
//   merkle_root: string          // hex, 64 chars
//   oracle_sig:  string          // hex, 128 chars (64-byte Ed25519 sig)
//   deadline:    number          // unix timestamp i64
//   epoch_number: number
//   amount:      string          // lamport-scale token amount (as string to avoid JS precision loss)
//   proof:       string[]        // hex-encoded proof nodes
//   oracle_pubkey: string        // hex, 64 chars — client needs this to build Ed25519 ix
// }
//
// Rate limited: 10 req/min per address, 30 req/min per IP (middleware).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { solanaEnabled } from '@/lib/web3/featureFlags'
import { getOraclePublicKey } from '@/lib/web3/solanaPublisher'

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export async function GET(req: NextRequest) {
  if (!solanaEnabled) {
    return NextResponse.json({ error: 'solana_claims_paused' }, { status: 410 })
  }

  const { searchParams } = req.nextUrl
  const campaignId   = searchParams.get('campaign_id')
  const epochStr     = searchParams.get('epoch_number')
  const wallet       = searchParams.get('wallet')

  if (!campaignId || !epochStr || !wallet) {
    return NextResponse.json(
      { error: 'campaign_id, epoch_number, and wallet are required' },
      { status: 400 }
    )
  }

  if (!SOLANA_RE.test(wallet)) {
    return NextResponse.json({ error: 'invalid wallet address' }, { status: 422 })
  }

  const epochNumber = parseInt(epochStr, 10)
  if (isNaN(epochNumber) || epochNumber < 1) {
    return NextResponse.json({ error: 'invalid epoch_number' }, { status: 422 })
  }

  const supabase = createSupabaseServiceClient()

  // Fetch distribution record
  const { data: dist, error: distErr } = await supabase
    .from('sol_distributions')
    .select('merkle_root, tree_json, oracle_sig, deadline, status')
    .eq('campaign_id', campaignId)
    .eq('epoch_number', epochNumber)
    .maybeSingle()

  if (distErr) {
    console.error('[claim/sol] DB error:', distErr.message)
    return NextResponse.json({ error: 'database error' }, { status: 500 })
  }

  if (!dist) {
    return NextResponse.json({ error: 'distribution not found' }, { status: 404 })
  }

  if (dist.status === 'pending') {
    return NextResponse.json({ error: 'distribution not yet published' }, { status: 404 })
  }

  if (!dist.deadline) {
    // No fallback — deadline must be set at publish time
    console.error(`[claim/sol] null deadline for campaign=${campaignId} epoch=${epochNumber}`)
    return NextResponse.json({ error: 'distribution deadline not set' }, { status: 500 })
  }

  // Look up wallet in tree_json leaves — O(1) with pre-computed proof
  const tree = dist.tree_json as {
    root:   string
    leaves: Array<{ wallet: string; amount: string; proof: string[] }>
  }

  const leaf = tree.leaves?.find(
    (l) => l.wallet.toLowerCase() === wallet.toLowerCase() ||
           l.wallet === wallet  // Solana case-sensitive
  )

  if (!leaf) {
    return NextResponse.json(
      { error: 'wallet not found in this distribution' },
      { status: 404 }
    )
  }

  // Get oracle public key (from loaded keypair — same key stored in program GlobalState)
  let oraclePubkey: string
  try {
    oraclePubkey = getOraclePublicKey()
  } catch (err) {
    console.error('[claim/sol] oracle key error:', err)
    return NextResponse.json({ error: 'oracle configuration error' }, { status: 500 })
  }

  return NextResponse.json({
    merkle_root:   dist.merkle_root,
    oracle_sig:    dist.oracle_sig,
    deadline:      dist.deadline,
    epoch_number:  epochNumber,
    amount:        leaf.amount,
    proof:         leaf.proof,
    oracle_pubkey: oraclePubkey,
  })
}

export async function POST() {
  if (!solanaEnabled) {
    return NextResponse.json({ error: 'solana_claims_paused' }, { status: 410 })
  }

  return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
}

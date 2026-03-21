// =============================================================================
// GET /api/claim?address=&distribution_id=
//
// Returns everything a wallet needs to call claim() on MintwareDistributor v2.
//
// Zero-gas oracle model: the oracle signed the Merkle root off-chain using
// EIP-712 (including a deadline). The oracle_signature + deadline are returned
// here so the user can submit them alongside their proof in a single claim()
// transaction — no oracle gas ever.
//
// claim(campaignId, epochNumber, merkleRoot, oracleSignature, deadline, amount, proof)
//   ↑ campaign_id   ↑ epoch_number  ↑ merkle_root  ↑ oracle_signature
//   ↑ deadline (unix ts)  ↑ amount_wei (this wallet)  ↑ merkle_proof
//
// SECURITY: tree_json is fetched via service role and is NEVER included in the
// response. Only the individual wallet's proof (a string[]) is returned.
// Returning the full tree would expose every other wallet's allocation.
//
// IMPORTANT — oracle backend must:
//   1. Choose a deadline (e.g. Date.now()/1000 + 30 days) when signing the root.
//   2. Include deadline in the RootPublication typedData message.
//   3. Store deadline in distributions.deadline alongside oracle_signature.
//   Without deadline in the DB, this route returns a console warning and
//   falls back to a 90-day window from now — remove this fallback after
//   the oracle backend is updated.
//
// Response:
//   200 { distribution_id, campaign_id, epoch_number, merkle_root,
//          oracle_signature, deadline, amount_wei, merkle_proof,
//          contract_address, chain, token_address, token_symbol }
//   400 Missing required params
//   404 Distribution not found, or wallet not in this distribution
//   409 Distribution not yet signed by oracle (status: 'pending')
//   410 Wallet has already claimed this distribution
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'

// ---------------------------------------------------------------------------
// In-memory rate limiter — max 10 requests per address per 60s window.
//
// Note: Vercel serverless functions are single-process per instance, so this
// state is per-instance, not globally shared. It caps abuse per function
// instance and is sufficient for MVP traffic. For global rate limiting,
// replace with Upstash Redis or Vercel KV.
// ---------------------------------------------------------------------------
interface RateLimitEntry { count: number; resetAt: number }
const rateLimitMap = new Map<string, RateLimitEntry>()
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false
  }
  entry.count++
  return true
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const rawAddress = searchParams.get('address')
  const distributionId = searchParams.get('distribution_id')

  // ---------------------------------------------------------------------------
  // Validate params
  // ---------------------------------------------------------------------------
  if (!rawAddress || !distributionId) {
    return NextResponse.json(
      { error: 'address and distribution_id are required' },
      { status: 400 }
    )
  }

  // Normalise address to lowercase for tree lookup — StandardMerkleTree
  // lowercases addresses when building leaves.
  const address = rawAddress.toLowerCase()

  // Rate limit: 10 requests per address per 60s
  if (!checkRateLimit(address)) {
    return NextResponse.json(
      { error: 'Too many requests — max 10 per minute per address' },
      { status: 429 }
    )
  }

  const supabase = createSupabaseServiceClient()

  // ---------------------------------------------------------------------------
  // Fetch distribution
  // Join campaigns to get chain routing + token metadata.
  // tree_json is fetched here but NEVER forwarded to the client.
  // oracle_signature is returned so the user can submit it in claim().
  // ---------------------------------------------------------------------------
  const { data: dist, error: distErr } = await supabase
    .from('distributions')
    .select(`
      id,
      campaign_id,
      epoch_number,
      merkle_root,
      oracle_signature,
      deadline,
      tree_json,
      status,
      campaigns (
        token_contract,
        token_symbol,
        contract_address,
        chain
      )
    `)
    .eq('id', distributionId)
    .single()

  if (distErr || !dist) {
    return NextResponse.json(
      { error: 'Distribution not found' },
      { status: 404 }
    )
  }

  // ---------------------------------------------------------------------------
  // Guard: distribution must be published (oracle has signed the root)
  // 'pending' means the oracle has not yet signed — users cannot claim yet.
  // ---------------------------------------------------------------------------
  if (dist.status === 'pending') {
    return NextResponse.json(
      { error: 'Distribution is pending — oracle has not yet signed this root', status: dist.status },
      { status: 409 }
    )
  }

  // Guard: oracle_signature must be present (published distributions always have one)
  if (!dist.oracle_signature) {
    return NextResponse.json(
      { error: 'Distribution is missing oracle signature — contact support' },
      { status: 500 }
    )
  }

  // ---------------------------------------------------------------------------
  // Guard: check if wallet has already claimed (off-chain record)
  // daily_payouts.claimed_at is set by the on-chain event listener when a
  // Claimed event is detected. This is a best-effort check — the contract's
  // own claimed mapping is the authoritative source of truth.
  // ---------------------------------------------------------------------------
  const { data: payoutRow } = await supabase
    .from('daily_payouts')
    .select('claimed_at, amount_wei')
    .eq('campaign_id', dist.campaign_id)
    .eq('epoch_number', dist.epoch_number)
    .eq('wallet', address)
    .maybeSingle()

  if (payoutRow?.claimed_at) {
    return NextResponse.json(
      { error: 'Already claimed', claimed_at: payoutRow.claimed_at },
      { status: 410 }
    )
  }

  // ---------------------------------------------------------------------------
  // Guard: tree_json must exist
  // ---------------------------------------------------------------------------
  if (!dist.tree_json) {
    return NextResponse.json(
      { error: 'Distribution tree data not available' },
      { status: 404 }
    )
  }

  // ---------------------------------------------------------------------------
  // Reconstruct Merkle tree server-side and extract this wallet's proof
  //
  // StandardMerkleTree.load() deserialises the dump produced by tree.dump()
  // in merkleBuilder.ts. The tree was built as:
  //   StandardMerkleTree.of([[wallet, amount_wei]], ['address', 'uint256'])
  //
  // We iterate tree.entries() to find the leaf with address === wallet, then
  // call tree.getProof(index) to extract the inclusion proof.
  //
  // SECURITY: dist.tree_json is not forwarded. Only the per-wallet proof array
  // (a string[]) and the wallet's amount_wei are returned.
  // ---------------------------------------------------------------------------
  let proof: string[] | null = null
  let amountWei: string | null = null

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tree = StandardMerkleTree.load(dist.tree_json as any)

    for (const [i, [leafAddress, leafAmount]] of tree.entries()) {
      if ((leafAddress as string).toLowerCase() === address) {
        proof = tree.getProof(i)
        amountWei = leafAmount as string
        break
      }
    }
  } catch (err) {
    console.error('[claim] Failed to reconstruct Merkle tree:', err)
    return NextResponse.json(
      { error: 'Failed to generate proof — please retry' },
      { status: 500 }
    )
  }

  if (!proof || amountWei === null) {
    return NextResponse.json(
      { error: 'Wallet is not included in this distribution' },
      { status: 404 }
    )
  }

  // ---------------------------------------------------------------------------
  // Resolve deadline — oracle backend must store this in distributions.deadline.
  // If null (oracle not yet updated), fall back to 90 days from now.
  // REMOVE this fallback once the oracle backend is writing deadlines.
  // ---------------------------------------------------------------------------
  let deadline: number
  if (dist.deadline != null) {
    deadline = dist.deadline
  } else {
    console.warn('[claim] distributions.deadline is null — oracle backend not yet updated. Using 90-day fallback.')
    deadline = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60
  }

  // ---------------------------------------------------------------------------
  // Return everything needed to call claim() on MintwareDistributor v2:
  //   claim(campaignId, epochNumber, merkleRoot, oracleSignature, deadline, amount, proof)
  //
  // campaign is returned as an array by Supabase join — access first element.
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = Array.isArray(dist.campaigns) ? dist.campaigns[0] : (dist.campaigns as any)

  return NextResponse.json({
    distribution_id:   dist.id,
    campaign_id:       dist.campaign_id,          // string  — campaignId param for claim()
    epoch_number:      dist.epoch_number,          // uint256 — epochNumber param for claim()
    merkle_root:       dist.merkle_root,           // bytes32 — merkleRoot param for claim()
    oracle_signature:  dist.oracle_signature,      // bytes   — oracleSignature param for claim()
    deadline,                                      // uint256 — deadline param for claim() (unix timestamp)
    amount_wei:        amountWei,                  // uint256 — amount param for claim()
    merkle_proof:      proof,                      // bytes32[] — merkleProof param for claim()
    contract_address:  campaign?.contract_address ?? null,
    chain:             campaign?.chain ?? null,
    token_address:     campaign?.token_contract ?? null,
    token_symbol:      campaign?.token_symbol ?? null,
  })
}

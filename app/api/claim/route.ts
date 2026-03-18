// =============================================================================
// GET /api/claim?address=&distribution_id=
//
// Returns the Merkle proof + metadata needed for a wallet to call claim() on
// the MintwareDistributor contract.
//
// SECURITY: tree_json is fetched via service role and is NEVER included in the
// response. Only the individual wallet's proof (a string[]) is returned.
// Returning the full tree would expose every other wallet's allocation.
//
// Response:
//   200 { amount_wei, merkle_proof, distribution_id, contract_address, chain,
//          token_address, token_symbol, epoch_number }
//   400 Missing required params
//   404 Distribution not found, or wallet not in this distribution
//   409 Distribution not yet published on-chain (status: 'pending')
//   410 Wallet has already claimed this distribution
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'
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
  // ---------------------------------------------------------------------------
  const { data: dist, error: distErr } = await supabase
    .from('distributions')
    .select(`
      id,
      campaign_id,
      epoch_number,
      merkle_root,
      tree_json,
      status,
      onchain_id,
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
  // Guard: distribution must be published (root is on-chain)
  // 'pending' means the Merkle root has not yet been posted to the contract.
  // ---------------------------------------------------------------------------
  if (dist.status === 'pending') {
    return NextResponse.json(
      { error: 'Distribution is pending — rewards not yet claimable', status: dist.status },
      { status: 409 }
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
  // Return proof + metadata
  // campaign is returned as an array by Supabase join — access first element
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = Array.isArray(dist.campaigns) ? dist.campaigns[0] : (dist.campaigns as any)

  return NextResponse.json({
    distribution_id: dist.id,
    // onchain_id is the uint256 passed to claim() on the MintwareDistributor contract.
    // Null if the distribution has not yet been published on-chain.
    onchain_id: dist.onchain_id !== null ? String(dist.onchain_id) : null,
    epoch_number: dist.epoch_number,
    amount_wei: amountWei,
    merkle_proof: proof,
    contract_address: campaign?.contract_address ?? null,
    chain: campaign?.chain ?? null,
    token_address: campaign?.token_contract ?? null,
    token_symbol: campaign?.token_symbol ?? null,
  })
}

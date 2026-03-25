// =============================================================================
// POST /api/agents/campaigns/record — oracle signs a verified action
//
// v2 gasless pattern:
//   1. Caller submits action data + oracle secret
//   2. This route validates, updates Supabase for fast reads, signs EIP-712
//   3. Returns { signature, nonce, deadline } — agent submits to contract + pays gas
//
// Auth: Bearer AI_ATTRIBUTION_ORACLE_SECRET
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

const ORACLE_SECRET   = process.env.AI_ATTRIBUTION_ORACLE_SECRET
const ORACLE_PRIV_KEY = process.env.ORACLE_PRIVATE_KEY as Hex | undefined

// C2: Support both mainnet and testnet deployments.
// Set AI_ATTRIBUTION_CHAIN_ID=8453 in Vercel Production when deploying to Base mainnet.
// Falls back to Base Sepolia (84532) for testnet / local dev.
const CHAIN_ID = Number(process.env.AI_ATTRIBUTION_CHAIN_ID ?? 84532)
const CHAIN    = CHAIN_ID === 8453 ? base : baseSepolia

// Contract address is resolved per-chain.
// Set NEXT_PUBLIC_AI_ATTRIBUTION_CONTRACT_BASE for mainnet,
//     NEXT_PUBLIC_AI_ATTRIBUTION_CONTRACT_BASE_SEPOLIA for testnet.
const CONTRACT_ADDRESS = (
  CHAIN_ID === 8453
    ? (process.env.NEXT_PUBLIC_AI_ATTRIBUTION_CONTRACT_BASE ?? '0x0000000000000000000000000000000000000000')
    : (process.env.NEXT_PUBLIC_AI_ATTRIBUTION_CONTRACT_BASE_SEPOLIA ?? '0x0000000000000000000000000000000000000000')
) as Hex

// EIP-712 typed data definition — must match ACTION_TYPEHASH in AIAttribution.sol
const ACTION_TYPES = {
  RecordAction: [
    { name: 'agent',             type: 'address' },
    { name: 'volumeContributed', type: 'uint256' },
    { name: 'mwpContextHash',    type: 'bytes32' },
    { name: 'campaignId',        type: 'uint256' },
    { name: 'nonce',             type: 'uint256' },
    { name: 'deadline',          type: 'uint256' },
  ],
} as const

const NONCES_ABI = [{
  name: 'nonces',
  type: 'function',
  stateMutability: 'view',
  inputs:  [{ name: 'agent', type: 'address' }],
  outputs: [{ name: '',      type: 'uint256' }],
}] as const

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = req.headers.get('authorization')
  if (!ORACLE_SECRET || auth !== `Bearer ${ORACLE_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!ORACLE_PRIV_KEY) {
    return NextResponse.json({ error: 'oracle key not configured' }, { status: 500 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { address?: string; volumeWei?: string; mwpHash?: string; campaignId?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const address    = body.address?.toLowerCase()
  const volumeWei  = BigInt(body.volumeWei ?? '0')
  const mwpHash    = body.mwpHash?.toLowerCase() ?? null
  const campaignId = body.campaignId ?? 0

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  // ── Validate agent is registered ────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('ai_agent_profiles').select('address').eq('address', address).maybeSingle()
  if (!profile) return NextResponse.json({ error: 'agent not registered' }, { status: 404 })

  // H4: Read nonce + sign BEFORE writing to Supabase.
  // Previous order: DB write → nonce read → sign.
  // If the nonce read or signing step threw, the DB was already permanently updated,
  // causing score divergence (Supabase showed higher scores than on-chain).
  // Correct order: nonce → sign → (only on success) DB write.

  // ── Read current nonce from contract ────────────────────────────────────────
  const publicClient = createPublicClient({ chain: CHAIN, transport: http() })
  const nonce = await publicClient.readContract({
    address:      CONTRACT_ADDRESS,
    abi:          NONCES_ABI,
    functionName: 'nonces',
    args:         [address as Hex],
  }) as bigint

  // ── Sign EIP-712 message ─────────────────────────────────────────────────────
  // If this throws (bad key, RPC down) the DB will not be touched.
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
  const account  = privateKeyToAccount(ORACLE_PRIV_KEY)

  const signature = await account.signTypedData({
    domain: {
      name:              'AIAttribution',
      version:           '2',
      chainId:           CHAIN_ID,
      verifyingContract: CONTRACT_ADDRESS,
    },
    types:       ACTION_TYPES,
    primaryType: 'RecordAction',
    message: {
      agent:             address as Hex,
      volumeContributed: volumeWei,
      mwpContextHash:    (mwpHash ?? `0x${'00'.repeat(32)}`) as Hex,
      campaignId:        BigInt(campaignId),
      nonce,
      deadline,
    },
  })

  // ── Signing succeeded — now update Supabase for fast reads ──────────────────
  const behaviorDelta = Number(volumeWei / BigInt(1e18))

  const { data: score } = await supabase
    .from('ai_agent_scores').select('behavior, interpretability, mwp_submissions').eq('address', address).maybeSingle()

  const updates: Record<string, unknown> = {
    behavior: (Number(score?.behavior ?? 0) + behaviorDelta),
  }

  if (mwpHash && /^0x[0-9a-f]{64}$/.test(mwpHash)) {
    const { data: existing } = await supabase
      .from('ai_agent_mwp_hashes').select('id').eq('address', address).eq('mwp_hash', mwpHash).maybeSingle()
    if (!existing) {
      const current = Number(score?.interpretability ?? 0)
      updates.interpretability = current + Math.min(50, Math.max(0, 500 - current))
      updates.mwp_submissions  = (score?.mwp_submissions ?? 0) + 1
      updates.is_transparent   = true
      updates.last_mwp_hash    = mwpHash
      await supabase.from('ai_agent_mwp_hashes').insert({ address, mwp_hash: mwpHash })
    }
  }

  await supabase.from('ai_agent_scores').update(updates).eq('address', address)

  if (campaignId > 0) {
    const { data: cv } = await supabase
      .from('ai_campaign_volume').select('volume_wei').eq('campaign_id', campaignId).eq('address', address).maybeSingle()
    if (cv) {
      await supabase.from('ai_campaign_volume')
        .update({ volume_wei: (BigInt(cv.volume_wei ?? '0') + volumeWei).toString() })
        .eq('campaign_id', campaignId).eq('address', address)
    } else {
      await supabase.from('ai_campaign_volume')
        .insert({ campaign_id: campaignId, address, volume_wei: volumeWei.toString() })
    }
  }

  return NextResponse.json({
    ok:           true,
    signature,
    nonce:        nonce.toString(),
    deadline:     deadline.toString(),
    address,
    behaviorDelta,
    campaignId,
  })
}

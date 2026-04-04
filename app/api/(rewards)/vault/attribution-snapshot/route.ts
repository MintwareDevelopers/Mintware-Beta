// =============================================================================
// GET /api/vault/attribution-snapshot?vault_id=&wallet=
//
// Returns vault weighting metadata plus an oracle-signed AttributionSnapshot
// payload compatible with FeeVault.sol.
//
// Called during epoch close to weight LP distributions by Attribution score.
//
// The oracle signs the exact payload FeeVault expects:
//   { wallet, liquidityPercentile, sharingPercentile, epochNumber, deadline }
//
// We still return multiplier fields for the current off-chain epoch processor,
// but the signature metadata now matches the on-chain contract instead of a
// route-local shape.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { API } from '@/lib/web2/api'

// Attribution multiplier bands (matches Phase 2 architecture doc)
function attributionMultiplierBps(percentile: number): number {
  if (percentile >= 67) return 15000  // 1.5×
  if (percentile >= 34) return 12500  // 1.25×
  return 10000                        // 1.0×
}

// Lock duration multiplier (days held → multiplier)
function durationMultiplierBps(depositedAt: string): number {
  const days = (Date.now() - new Date(depositedAt).getTime()) / 86_400_000
  if (days >= 180) return 13000  // 1.3×
  if (days >= 90)  return 12000  // 1.2×
  if (days >= 30)  return 11000  // 1.1×
  return 10000                   // 1.0×
}

// Combined multiplier: attribution × duration (capped at 1.95×)
function combinedMultiplierBps(attrBps: number, durBps: number): number {
  const combined = Math.round((attrBps * durBps) / 10000)
  return Math.min(combined, 19500)  // 1.95× cap
}

const CLAIM_EXPIRY_SECS = 90 * 24 * 60 * 60

// EIP-712 typed data — must match FeeVault.sol ATTRIBUTION_SNAPSHOT_TYPEHASH
const ATTESTATION_DOMAIN = {
  name:    'FeeVault',
  version: '1',
} as const

const ATTESTATION_TYPES = {
  AttributionSnapshot: [
    { name: 'wallet',              type: 'address' },
    { name: 'liquidityPercentile', type: 'uint16'  },
    { name: 'sharingPercentile',   type: 'uint16'  },
    { name: 'epochNumber',         type: 'uint256' },
    { name: 'deadline',            type: 'uint256' },
  ],
} as const

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const vault_id = searchParams.get('vault_id')
  const wallet   = searchParams.get('wallet')

  if (!vault_id || !wallet) {
    return NextResponse.json({ error: 'Missing vault_id or wallet' }, { status: 400 })
  }

  const walletAddr = wallet.toLowerCase() as `0x${string}`

  // ── Fetch vault to get chain ────────────────────────────────────────────
  const supabase = createSupabaseServiceClient()
  const { data: vault, error: vaultErr } = await supabase
    .from('social_vaults')
    .select('id, chain_id')
    .eq('id', vault_id)
    .single()

  if (vaultErr || !vault) {
    return NextResponse.json({ error: 'Vault not found' }, { status: 404 })
  }

  // ── Fetch Attribution score ─────────────────────────────────────────────
  let percentile = 0
  try {
    const scoreRes = await fetch(`${API}/score?address=${walletAddr}`)
    if (scoreRes.ok) {
      const scoreData = await scoreRes.json()
      percentile = scoreData.percentile ?? 0
    }
  } catch {
    // Non-fatal — default to 0th percentile (1.0× multiplier)
  }

  // ── Fetch deposit for duration multiplier ───────────────────────────────
  let durationBps = 10000
  try {
    const { data: deposit } = await supabase
      .from('lp_deposits')
      .select('deposited_at')
      .eq('vault_id', vault_id)
      .eq('wallet', walletAddr)
      .eq('status', 'active')
      .order('deposited_at', { ascending: true })
      .limit(1)
      .single()

    if (deposit) durationBps = durationMultiplierBps(deposit.deposited_at)
  } catch { /* non-fatal */ }

  // ── Resolve the current epoch context used by FeeVault signatures ───────
  const { data: epoch } = await supabase
    .from('vault_epochs')
    .select('epoch_number, deadline, status')
    .eq('vault_id', vault_id)
    .in('status', ['active', 'settling', 'published'])
    .order('epoch_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const epochNumber = epoch?.epoch_number ?? 1
  const deadline = epoch?.deadline
    ? Math.floor(new Date(epoch.deadline).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + CLAIM_EXPIRY_SECS

  // ── Compute combined multiplier ─────────────────────────────────────────
  const attrBps    = attributionMultiplierBps(percentile)
  const multBps    = combinedMultiplierBps(attrBps, durationBps)
  const liquidityPercentile = percentile
  const sharingPercentile = percentile

  // ── Sign EIP-712 ────────────────────────────────────────────────────────
  const oracleKey = process.env.DISTRIBUTOR_PRIVATE_KEY
  if (!oracleKey) {
    console.error('[attribution-snapshot] DISTRIBUTOR_PRIVATE_KEY not set')
    return NextResponse.json({ error: 'Oracle not configured' }, { status: 500 })
  }

  const keyHex = oracleKey.startsWith('0x') ? oracleKey : `0x${oracleKey}`
  const account = privateKeyToAccount(keyHex as `0x${string}`)

  // Use correct chain for domain chainId
  const chain     = vault.chain_id === 8453 ? base : baseSepolia

  let signature: `0x${string}`
  try {
    const client = createWalletClient({ account, chain, transport: http() })
    signature = await client.signTypedData({
      domain:      { ...ATTESTATION_DOMAIN, chainId: chain.id },
      types:       ATTESTATION_TYPES,
      primaryType: 'AttributionSnapshot',
      message: {
        wallet: walletAddr,
        liquidityPercentile,
        sharingPercentile,
        epochNumber: BigInt(epochNumber),
        deadline: BigInt(deadline),
      },
    })
  } catch (e: unknown) {
    console.error('[attribution-snapshot] signing failed:', e)
    return NextResponse.json({ error: 'Oracle signing failed' }, { status: 500 })
  }

  // ── Return snapshot (never log the full signature) ──────────────────────
  return NextResponse.json({
    vault_id,
    wallet:         walletAddr,
    percentile,
    liquidity_percentile:       liquidityPercentile,
    sharing_percentile:         sharingPercentile,
    attribution_multiplier_bps: attrBps,
    duration_multiplier_bps:    durationBps,
    combined_multiplier_bps:    multBps,
    combined_multiplier:        (multBps / 10000).toFixed(4),
    epoch_number:    epochNumber,
    deadline,
    oracle_signer: account.address,
    signature,
  })
}

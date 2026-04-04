// =============================================================================
// POST /api/vault/deposit
//
// Records an LP deposit after the on-chain tx is confirmed.
// The client calls this after the USDC transfer to SocialVault completes.
//
// Body:
//   { vault_id, wallet, usdc_amount, lock_tier, tx_hash, referrer? }
//
// Steps:
//   1. Validate body
//   2. Check vault exists + is active
//   3. Insert lp_deposits row
//   4. If referrer provided → upsert vault_referrals
//   5. Update social_vaults.tvl_usdc (increment)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import type { LockTier } from '@/lib/web2/vault/types'
import { buildVaultDepositMessage } from '@/lib/web3/signedActionMessages'
import { LOCK_TIER_INDEX, SOCIAL_VAULT_ABI } from '@/lib/web3/vault/socialVaultAbi'
import {
  createPublicClient,
  decodeFunctionData,
  http,
  parseUnits,
  recoverMessageAddress,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'

const LOCK_TIERS: LockTier[] = ['flex', 'committed', 'aligned', 'core']

// Lock period in days per tier (null = no lock)
const LOCK_DAYS: Record<LockTier, number | null> = {
  flex:      null,
  committed: 30,
  aligned:   90,
  core:      180,
}

interface DepositPayload {
  vault_id:    string
  wallet:      string
  usdc_amount: number
  lock_tier:   LockTier
  tx_hash:     string
  referrer?:   string
  issuedAt?:   number
  authMessage?: string
  authSignature?: `0x${string}`
}

const MAX_AUTH_AGE_MS = 15 * 60 * 1000

function validate(body: unknown): body is DepositPayload {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.vault_id    === 'string' && b.vault_id.length > 0 &&
    typeof b.wallet      === 'string' && (b.wallet as string).startsWith('0x') &&
    typeof b.usdc_amount === 'number' && b.usdc_amount > 0 &&
    typeof b.lock_tier   === 'string' && LOCK_TIERS.includes(b.lock_tier as LockTier) &&
    typeof b.tx_hash     === 'string' && b.tx_hash.length > 0
  )
}

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!validate(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { vault_id, wallet, usdc_amount, lock_tier, tx_hash, referrer } = body
  const walletLower   = wallet.toLowerCase()
  const referrerLower = referrer?.toLowerCase() ?? null

  const supabase = createSupabaseServiceClient()

  // ── 1. Vault must exist and be active ──────────────────────────────────
  const { data: vault, error: vaultErr } = await supabase
    .from('social_vaults')
    .select('id, status, tvl_usdc, contract_address, chain_id')
    .eq('id', vault_id)
    .single()

  if (vaultErr || !vault) {
    return NextResponse.json({ error: 'Vault not found' }, { status: 404 })
  }
  if (vault.status !== 'active' && vault.status !== 'seeding') {
    return NextResponse.json({ error: `Vault is ${vault.status}` }, { status: 409 })
  }

  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number') {
    return NextResponse.json({ error: 'Signed authorization required' }, { status: 401 })
  }

  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS) {
    return NextResponse.json({ error: 'Authorization expired' }, { status: 401 })
  }

  const expectedMessage = buildVaultDepositMessage({
    vaultId: vault_id,
    wallet,
    usdcAmount: usdc_amount,
    lockTier: lock_tier,
    txHash: tx_hash,
    referrer,
    issuedAt: body.issuedAt,
  })

  if (body.authMessage !== expectedMessage) {
    return NextResponse.json({ error: 'Authorization payload mismatch' }, { status: 401 })
  }

  const signer = await recoverMessageAddress({
    message: body.authMessage,
    signature: body.authSignature,
  }).catch(() => null)

  if (!signer || signer.toLowerCase() !== walletLower) {
    return NextResponse.json({ error: 'Invalid authorization signature' }, { status: 401 })
  }

  const vaultAddress = (vault.contract_address ?? process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? '').toLowerCase()
  if (!vaultAddress) {
    return NextResponse.json({ error: 'Vault contract is not configured' }, { status: 500 })
  }

  const chain = Number(vault.chain_id) === 8453 ? base : baseSepolia
  const transport = http(
    Number(vault.chain_id) === 8453
      ? (process.env.BASE_RPC_URL ?? 'https://mainnet.base.org')
      : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'),
  )
  const publicClient = createPublicClient({ chain, transport })

  const [tx, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: tx_hash as `0x${string}` }).catch(() => null),
    publicClient.getTransactionReceipt({ hash: tx_hash as `0x${string}` }).catch(() => null),
  ])

  if (!tx || !receipt) {
    return NextResponse.json({ error: 'Deposit transaction not yet verifiable' }, { status: 409 })
  }
  if (receipt.status !== 'success') {
    return NextResponse.json({ error: 'Deposit transaction failed' }, { status: 409 })
  }
  if ((receipt.from ?? '').toLowerCase() !== walletLower) {
    return NextResponse.json({ error: 'Deposit transaction wallet mismatch' }, { status: 403 })
  }
  if ((tx.to ?? '').toLowerCase() !== vaultAddress) {
    return NextResponse.json({ error: 'Deposit transaction target mismatch' }, { status: 403 })
  }

  const decoded = decodeFunctionData({
    abi: SOCIAL_VAULT_ABI,
    data: tx.input,
  })

  if (decoded.functionName !== 'deposit') {
    return NextResponse.json({ error: 'Deposit transaction calldata mismatch' }, { status: 403 })
  }

  const [amountWei, tierIndex] = decoded.args
  if (amountWei !== parseUnits(String(usdc_amount), 6)) {
    return NextResponse.json({ error: 'Deposit amount mismatch' }, { status: 403 })
  }
  if (Number(tierIndex) !== LOCK_TIER_INDEX[lock_tier]) {
    return NextResponse.json({ error: 'Deposit tier mismatch' }, { status: 403 })
  }

  // ── 2. Compute locked_until ─────────────────────────────────────────────
  const lockDays    = LOCK_DAYS[lock_tier]
  const lockedUntil = lockDays
    ? new Date(Date.now() + lockDays * 86_400_000).toISOString()
    : null

  // ── 3. Insert deposit ───────────────────────────────────────────────────
  const { data: deposit, error: depErr } = await supabase
    .from('lp_deposits')
    .insert({
      vault_id,
      wallet:      walletLower,
      usdc_amount,
      lock_tier,
      locked_until: lockedUntil,
      status:      'active',
    })
    .select('id')
    .single()

  if (depErr || !deposit) {
    console.error('[vault/deposit] insert failed:', depErr?.message)
    return NextResponse.json({ error: 'Failed to record deposit' }, { status: 500 })
  }

  // ── 4. Upsert vault_referrals if referrer provided ──────────────────────
  if (referrerLower && referrerLower !== walletLower) {
    await supabase
      .from('vault_referrals')
      .upsert(
        {
          vault_id,
          referrer:        referrerLower,
          referred_wallet: walletLower,
          deposit_id:      deposit.id,
          net_liquidity:   usdc_amount,
        },
        { onConflict: 'vault_id,referred_wallet', ignoreDuplicates: false }
      )
  }

  // ── 5. Increment vault TVL ──────────────────────────────────────────────
  await supabase
    .from('social_vaults')
    .update({ tvl_usdc: (vault.tvl_usdc ?? 0) + usdc_amount })
    .eq('id', vault_id)

  return NextResponse.json({ ok: true, deposit_id: deposit.id }, { status: 201 })
}

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
}

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
    .select('id, status, tvl_usdc')
    .eq('id', vault_id)
    .single()

  if (vaultErr || !vault) {
    return NextResponse.json({ error: 'Vault not found' }, { status: 404 })
  }
  if (vault.status !== 'active' && vault.status !== 'seeding') {
    return NextResponse.json({ error: `Vault is ${vault.status}` }, { status: 409 })
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

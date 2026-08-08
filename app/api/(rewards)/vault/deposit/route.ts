// POST /api/vault/deposit
// Records an LP deposit after on-chain tx is confirmed.
// Auth: inline signed-message (buildVaultDepositMessage format)

import { createHandler } from '@/lib/web2/routeHandler'
import type { LockTier } from '@/lib/web2/vault/types'
import { buildVaultDepositMessage } from '@/lib/web3/signedActionMessages'
import { LOCK_TIER_INDEX, SOCIAL_VAULT_ABI } from '@/lib/web3/vault/socialVaultAbi'
import { createPublicClient, decodeFunctionData, http, parseUnits, recoverMessageAddress } from 'viem'
import { base, baseSepolia } from 'viem/chains'

const LOCK_TIERS: LockTier[] = ['flex', 'committed', 'aligned', 'core']
const LOCK_DAYS: Record<LockTier, number | null> = { flex: null, committed: 30, aligned: 90, core: 180 }
const MAX_AUTH_AGE_MS = 15 * 60 * 1000

interface DepositPayload {
  vault_id: string; wallet: string; usdc_amount: number; lock_tier: LockTier
  tx_hash: string; referrer?: string; issuedAt?: number; authMessage?: string; authSignature?: `0x${string}`
}

function validate(b: unknown): b is DepositPayload {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.vault_id === 'string' && p.vault_id.length > 0 &&
    typeof p.wallet === 'string' && (p.wallet as string).startsWith('0x') &&
    typeof p.usdc_amount === 'number' && p.usdc_amount > 0 &&
    typeof p.lock_tier === 'string' && LOCK_TIERS.includes(p.lock_tier as LockTier) &&
    typeof p.tx_hash === 'string' && p.tx_hash.length > 0
  )
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'Invalid JSON' }, 400) }
  if (!validate(body)) return ctx.json({ error: 'Invalid request body' }, 400)

  const { vault_id, wallet, usdc_amount, lock_tier, tx_hash, referrer } = body
  const walletLower   = wallet.toLowerCase()
  const referrerLower = referrer?.toLowerCase() ?? null

  const { data: vault, error: vaultErr } = await ctx.supabase
    .from('social_vaults').select('id, status, tvl_usdc, contract_address, chain_id').eq('id', vault_id).single()
  if (vaultErr || !vault) return ctx.json({ error: 'Vault not found' }, 404)
  if (vault.status !== 'active' && vault.status !== 'seeding') return ctx.json({ error: `Vault is ${vault.status}` }, 409)

  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number')
    return ctx.json({ error: 'Signed authorization required' }, 401)
  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS)
    return ctx.json({ error: 'Authorization expired' }, 401)

  const expectedMessage = buildVaultDepositMessage({ vaultId: vault_id, wallet, usdcAmount: usdc_amount, lockTier: lock_tier, txHash: tx_hash, referrer, issuedAt: body.issuedAt })
  if (body.authMessage !== expectedMessage) return ctx.json({ error: 'Authorization payload mismatch' }, 401)

  const signer = await recoverMessageAddress({ message: body.authMessage, signature: body.authSignature }).catch(() => null)
  if (!signer || signer.toLowerCase() !== walletLower) return ctx.json({ error: 'Invalid authorization signature' }, 401)

  const vaultAddress = (vault.contract_address ?? process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? '').toLowerCase()
  if (!vaultAddress) return ctx.json({ error: 'Vault contract is not configured' }, 500)

  const chain = Number(vault.chain_id) === 8453 ? base : baseSepolia
  const transport = http(Number(vault.chain_id) === 8453 ? (process.env.BASE_RPC_URL ?? 'https://mainnet.base.org') : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'))
  const publicClient = createPublicClient({ chain, transport })

  const [tx, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: tx_hash as `0x${string}` }).catch(() => null),
    publicClient.getTransactionReceipt({ hash: tx_hash as `0x${string}` }).catch(() => null),
  ])

  if (!tx || !receipt) return ctx.json({ error: 'Deposit transaction not yet verifiable' }, 409)
  if (receipt.status !== 'success') return ctx.json({ error: 'Deposit transaction failed' }, 409)
  if ((receipt.from ?? '').toLowerCase() !== walletLower) return ctx.json({ error: 'Deposit transaction wallet mismatch' }, 403)
  if ((tx.to ?? '').toLowerCase() !== vaultAddress) return ctx.json({ error: 'Deposit transaction target mismatch' }, 403)

  const decoded = decodeFunctionData({ abi: SOCIAL_VAULT_ABI, data: tx.input })
  if (decoded.functionName !== 'depositWithLock') return ctx.json({ error: 'Deposit transaction calldata mismatch' }, 403)

  // depositWithLock(assets, receiver, tier) — skip the receiver arg
  const [amountWei, , tierIndex] = decoded.args
  if (amountWei !== parseUnits(String(usdc_amount), 6)) return ctx.json({ error: 'Deposit amount mismatch' }, 403)
  if (Number(tierIndex) !== LOCK_TIER_INDEX[lock_tier]) return ctx.json({ error: 'Deposit tier mismatch' }, 403)

  const lockDays    = LOCK_DAYS[lock_tier]
  const lockedUntil = lockDays ? new Date(Date.now() + lockDays * 86_400_000).toISOString() : null

  const { data: deposit, error: depErr } = await ctx.supabase
    .from('lp_deposits')
    .insert({ vault_id, wallet: walletLower, usdc_amount, lock_tier, locked_until: lockedUntil, status: 'active', tx_hash })
    .select('id').single()

  if (depErr) {
    // 23505 = unique violation on tx_hash → this on-chain deposit was already
    // recorded. Idempotent: return ok WITHOUT re-crediting positions/TVL/referrals
    // (this is the replay-protection guard).
    if (depErr.code === '23505') {
      ctx.log.info('vault/deposit', 'duplicate tx_hash — already recorded, skipping credit', { tx_hash })
      return ctx.json({ ok: true, duplicate: true }, 200)
    }
    ctx.log.error('vault/deposit', 'insert failed', { error: depErr.message })
    return ctx.json({ error: 'Failed to record deposit' }, 500)
  }
  if (!deposit) return ctx.json({ error: 'Failed to record deposit' }, 500)

  // Mirror the deposit into vault_lp_positions — the source of truth the weighted
  // epoch cron reads to compute reward weights (lp_deposits is the per-tx ledger;
  // this is the per-wallet aggregate). Accumulate liquidity_units across deposits.
  // (liquidity_units = USDC contributed; the cron applies lock-tier + attribution
  // multipliers on top.) Best-effort: a failure here must not fail the deposit.
  try {
    const { data: existingPos } = await ctx.supabase
      .from('vault_lp_positions')
      .select('liquidity_units')
      .eq('vault_id', vault_id).eq('wallet', walletLower).maybeSingle()
    const newUnits = Number(existingPos?.liquidity_units ?? 0) + usdc_amount
    await ctx.supabase.from('vault_lp_positions').upsert(
      { vault_id, wallet: walletLower, liquidity_units: newUnits, lock_tier, status: 'active' },
      { onConflict: 'vault_id,wallet', ignoreDuplicates: false },
    )
  } catch (e) {
    ctx.log.warn('vault/deposit', 'vault_lp_positions upsert failed', { error: e instanceof Error ? e.message : String(e) })
  }

  if (referrerLower && referrerLower !== walletLower) {
    await ctx.supabase.from('vault_referrals').upsert(
      { vault_id, referrer: referrerLower, referred_wallet: walletLower, deposit_id: deposit.id, net_liquidity: usdc_amount },
      { onConflict: 'vault_id,referred_wallet', ignoreDuplicates: false }
    )
  }

  await ctx.supabase.from('social_vaults').update({ tvl_usdc: (vault.tvl_usdc ?? 0) + usdc_amount }).eq('id', vault_id)

  return ctx.json({ ok: true, deposit_id: deposit.id }, 201)
})

// POST /api/vault/withdraw
// Queues a withdrawal with optional early-exit penalty.
// Auth: inline signed-message (buildVaultWithdrawMessage format)

import { createHandler } from '@/lib/web2/routeHandler'
import { buildVaultWithdrawMessage } from '@/lib/web3/signedActionMessages'
import { PAIR_VAULT_ABI } from '@/lib/web3/vault/pairVaultAbi'
import { createPublicClient, decodeFunctionData, http, recoverMessageAddress } from 'viem'
import { base, baseSepolia } from 'viem/chains'

interface WithdrawPayload {
  deposit_id: string; wallet: string; requested_amount: number; tx_hash: string
  issuedAt?: number; authMessage?: string; authSignature?: `0x${string}`
}

const MAX_AUTH_AGE_MS = 15 * 60 * 1000

function validate(b: unknown): b is WithdrawPayload {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.deposit_id === 'string' && p.deposit_id.length > 0 &&
    typeof p.wallet === 'string' && (p.wallet as string).startsWith('0x') &&
    typeof p.requested_amount === 'number' && p.requested_amount > 0 &&
    typeof p.tx_hash === 'string' && p.tx_hash.length > 0
  )
}

function calcPenalty(deposit: { lock_tier: string; usdc_amount: number; deposited_at: string; locked_until: string | null }, amount: number) {
  if (deposit.lock_tier === 'flex' || !deposit.locked_until) return { pct: 0, amount: 0 }
  const now = Date.now(), start = new Date(deposit.deposited_at).getTime(), end = new Date(deposit.locked_until).getTime()
  const pctElapsed = (end - start) > 0 ? (now - start) / (end - start) : 1
  const pct = pctElapsed < 0.2 ? 2.0 : pctElapsed < 0.5 ? 1.0 : pctElapsed < 0.8 ? 0.5 : 0
  return { pct, amount: (amount * pct) / 100 }
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'Invalid JSON' }, 400) }
  if (!validate(body)) return ctx.json({ error: 'Invalid request body' }, 400)

  const { deposit_id, wallet, requested_amount, tx_hash } = body
  const walletLower = wallet.toLowerCase()

  const { data: deposit, error: depErr } = await ctx.supabase
    .from('lp_deposits')
    .select('id, vault_id, wallet, usdc_amount, lock_tier, deposited_at, locked_until, status, social_vaults!inner(contract_address, chain_id)')
    .eq('id', deposit_id).single()

  if (depErr || !deposit) return ctx.json({ error: 'Deposit not found' }, 404)
  if (deposit.wallet !== walletLower) return ctx.json({ error: 'Unauthorized' }, 403)
  if (deposit.status !== 'active') return ctx.json({ error: `Deposit status is ${deposit.status}` }, 409)
  if (requested_amount > deposit.usdc_amount) return ctx.json({ error: 'Amount exceeds deposit' }, 400)

  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number')
    return ctx.json({ error: 'Signed authorization required' }, 401)
  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS)
    return ctx.json({ error: 'Authorization expired' }, 401)

  const expectedMessage = buildVaultWithdrawMessage({ depositId: deposit_id, wallet, requestedAmount: requested_amount, txHash: tx_hash, issuedAt: body.issuedAt })
  if (body.authMessage !== expectedMessage) return ctx.json({ error: 'Authorization payload mismatch' }, 401)

  const signer = await recoverMessageAddress({ message: body.authMessage, signature: body.authSignature }).catch(() => null)
  if (!signer || signer.toLowerCase() !== walletLower) return ctx.json({ error: 'Invalid authorization signature' }, 401)

  const vaultMeta = Array.isArray(deposit.social_vaults) ? deposit.social_vaults[0] : deposit.social_vaults
  const vaultAddress = (vaultMeta?.contract_address ?? process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? '').toLowerCase()
  if (!vaultAddress) return ctx.json({ error: 'Vault contract is not configured' }, 500)

  const chain = Number(vaultMeta?.chain_id) === 8453 ? base : baseSepolia
  const transport = http(Number(vaultMeta?.chain_id) === 8453 ? (process.env.BASE_RPC_URL ?? 'https://mainnet.base.org') : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'))
  const publicClient = createPublicClient({ chain, transport })
  const [tx, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: tx_hash as `0x${string}` }).catch(() => null),
    publicClient.getTransactionReceipt({ hash: tx_hash as `0x${string}` }).catch(() => null),
  ])

  if (!tx || !receipt) return ctx.json({ error: 'Withdrawal transaction not yet verifiable' }, 409)
  if (receipt.status !== 'success') return ctx.json({ error: 'Withdrawal transaction failed' }, 409)
  if ((receipt.from ?? '').toLowerCase() !== walletLower) return ctx.json({ error: 'Withdrawal transaction wallet mismatch' }, 403)
  if ((tx.to ?? '').toLowerCase() !== vaultAddress) return ctx.json({ error: 'Withdrawal transaction target mismatch' }, 403)

  const decoded = decodeFunctionData({ abi: PAIR_VAULT_ABI, data: tx.input })
  if (decoded.functionName !== 'requestRedeem') return ctx.json({ error: 'Withdrawal transaction calldata mismatch' }, 403)
  // requestRedeem(shares). On the pair vault `shares` are V4 liquidity units, NOT a USDC
  // amount — so there is no 1:1 USDC equality to assert here. `requested_amount` remains the
  // wallet-signed USDC display figure recorded for the queue; on-chain shares govern the funds.
  const [sharesWei] = decoded.args
  if (sharesWei <= 0n) return ctx.json({ error: 'Withdrawal shares must be positive' }, 403)

  const { pct: penalty_pct, amount: penalty_amount } = calcPenalty(deposit, requested_amount)
  const now = new Date()
  const executableAt = new Date(now.getTime() + 7 * 86_400_000)

  const { data: qEntry, error: qErr } = await ctx.supabase
    .from('withdrawal_queue')
    .insert({ deposit_id, wallet: walletLower, vault_id: deposit.vault_id, requested_amount, notice_given_at: now.toISOString(), executable_at: executableAt.toISOString(), penalty_pct, penalty_amount, status: 'pending' })
    .select('id').single()

  if (qErr || !qEntry) {
    ctx.log.error('vault/withdraw', 'queue insert failed', { error: qErr?.message })
    return ctx.json({ error: 'Failed to queue withdrawal' }, 500)
  }

  await ctx.supabase.from('lp_deposits').update({ status: 'withdrawal_pending' }).eq('id', deposit_id)

  return ctx.json({ ok: true, queue_id: qEntry.id, executable_at: executableAt.toISOString(), penalty_pct, penalty_amount }, 201)
})

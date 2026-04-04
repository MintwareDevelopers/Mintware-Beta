// =============================================================================
// POST /api/vault/withdraw
//
// Queues a withdrawal. Sets notice_given_at = now(), executable_at = now()+7d.
// Computes early-exit penalty if deposit is within lock period.
//
// Body: { deposit_id, wallet, requested_amount }
//
// Penalty schedule (applied if within lock period):
//   < 20% of lock elapsed  → 2.0%
//   20–50%                 → 1.0%
//   50–80%                 → 0.5%
//   > 80%                  → 0%
//   flex tier              → 0%
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { buildVaultWithdrawMessage } from '@/lib/web3/signedActionMessages'
import { SOCIAL_VAULT_ABI } from '@/lib/web3/vault/socialVaultAbi'
import {
  createPublicClient,
  decodeFunctionData,
  http,
  parseUnits,
  recoverMessageAddress,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'

interface WithdrawPayload {
  deposit_id:       string
  wallet:           string
  requested_amount: number
  tx_hash:          string
  issuedAt?:        number
  authMessage?:     string
  authSignature?:   `0x${string}`
}

const MAX_AUTH_AGE_MS = 15 * 60 * 1000

function validate(body: unknown): body is WithdrawPayload {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.deposit_id       === 'string' && b.deposit_id.length > 0 &&
    typeof b.wallet           === 'string' && (b.wallet as string).startsWith('0x') &&
    typeof b.requested_amount === 'number' && b.requested_amount > 0 &&
    typeof b.tx_hash          === 'string' && b.tx_hash.length > 0
  )
}

function calcPenalty(deposit: {
  lock_tier:    string
  usdc_amount:  number
  deposited_at: string
  locked_until: string | null
}, requestedAmount: number): { pct: number; amount: number } {
  if (deposit.lock_tier === 'flex' || !deposit.locked_until) {
    return { pct: 0, amount: 0 }
  }

  const now        = Date.now()
  const start      = new Date(deposit.deposited_at).getTime()
  const end        = new Date(deposit.locked_until).getTime()
  const total      = end - start
  const elapsed    = now - start
  const pctElapsed = total > 0 ? elapsed / total : 1

  let pct = 0
  if (pctElapsed < 0.2)       pct = 2.0
  else if (pctElapsed < 0.5)  pct = 1.0
  else if (pctElapsed < 0.8)  pct = 0.5

  const amount = (requestedAmount * pct) / 100
  return { pct, amount }
}

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!validate(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { deposit_id, wallet, requested_amount, tx_hash } = body
  const walletLower = wallet.toLowerCase()

  const supabase = createSupabaseServiceClient()

  // ── Fetch deposit ───────────────────────────────────────────────────────
  const { data: deposit, error: depErr } = await supabase
    .from('lp_deposits')
    .select('id, vault_id, wallet, usdc_amount, lock_tier, deposited_at, locked_until, status, social_vaults!inner(contract_address, chain_id)')
    .eq('id', deposit_id)
    .single()

  if (depErr || !deposit) {
    return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
  }
  if (deposit.wallet !== walletLower) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (deposit.status !== 'active') {
    return NextResponse.json({ error: `Deposit status is ${deposit.status}` }, { status: 409 })
  }
  if (requested_amount > deposit.usdc_amount) {
    return NextResponse.json({ error: 'Amount exceeds deposit' }, { status: 400 })
  }

  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number') {
    return NextResponse.json({ error: 'Signed authorization required' }, { status: 401 })
  }

  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS) {
    return NextResponse.json({ error: 'Authorization expired' }, { status: 401 })
  }

  const expectedMessage = buildVaultWithdrawMessage({
    depositId: deposit_id,
    wallet,
    requestedAmount: requested_amount,
    txHash: tx_hash,
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

  const vaultMeta = Array.isArray(deposit.social_vaults) ? deposit.social_vaults[0] : deposit.social_vaults
  const vaultAddress = (vaultMeta?.contract_address ?? process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? '').toLowerCase()
  if (!vaultAddress) {
    return NextResponse.json({ error: 'Vault contract is not configured' }, { status: 500 })
  }

  const chain = Number(vaultMeta?.chain_id) === 8453 ? base : baseSepolia
  const transport = http(
    Number(vaultMeta?.chain_id) === 8453
      ? (process.env.BASE_RPC_URL ?? 'https://mainnet.base.org')
      : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'),
  )
  const publicClient = createPublicClient({ chain, transport })
  const [tx, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: tx_hash as `0x${string}` }).catch(() => null),
    publicClient.getTransactionReceipt({ hash: tx_hash as `0x${string}` }).catch(() => null),
  ])

  if (!tx || !receipt) {
    return NextResponse.json({ error: 'Withdrawal transaction not yet verifiable' }, { status: 409 })
  }
  if (receipt.status !== 'success') {
    return NextResponse.json({ error: 'Withdrawal transaction failed' }, { status: 409 })
  }
  if ((receipt.from ?? '').toLowerCase() !== walletLower) {
    return NextResponse.json({ error: 'Withdrawal transaction wallet mismatch' }, { status: 403 })
  }
  if ((tx.to ?? '').toLowerCase() !== vaultAddress) {
    return NextResponse.json({ error: 'Withdrawal transaction target mismatch' }, { status: 403 })
  }

  const decoded = decodeFunctionData({
    abi: SOCIAL_VAULT_ABI,
    data: tx.input,
  })

  if (decoded.functionName !== 'requestWithdrawal') {
    return NextResponse.json({ error: 'Withdrawal transaction calldata mismatch' }, { status: 403 })
  }

  const [amountWei] = decoded.args
  if (amountWei !== parseUnits(String(requested_amount), 6)) {
    return NextResponse.json({ error: 'Withdrawal amount mismatch' }, { status: 403 })
  }

  // ── Compute penalty ─────────────────────────────────────────────────────
  const { pct: penalty_pct, amount: penalty_amount } = calcPenalty(deposit, requested_amount)

  const now          = new Date()
  const executableAt = new Date(now.getTime() + 7 * 86_400_000)

  // ── Insert queue entry ──────────────────────────────────────────────────
  const { data: qEntry, error: qErr } = await supabase
    .from('withdrawal_queue')
    .insert({
      deposit_id,
      wallet:           walletLower,
      vault_id:         deposit.vault_id,
      requested_amount,
      notice_given_at:  now.toISOString(),
      executable_at:    executableAt.toISOString(),
      penalty_pct,
      penalty_amount,
      status: 'pending',
    })
    .select('id')
    .single()

  if (qErr || !qEntry) {
    console.error('[vault/withdraw] queue insert failed:', qErr?.message)
    return NextResponse.json({ error: 'Failed to queue withdrawal' }, { status: 500 })
  }

  // ── Mark deposit as withdrawal_pending ──────────────────────────────────
  await supabase
    .from('lp_deposits')
    .update({ status: 'withdrawal_pending' })
    .eq('id', deposit_id)

  return NextResponse.json({
    ok: true,
    queue_id:      qEntry.id,
    executable_at: executableAt.toISOString(),
    penalty_pct,
    penalty_amount,
  }, { status: 201 })
}

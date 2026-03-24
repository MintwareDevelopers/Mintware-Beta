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

interface WithdrawPayload {
  deposit_id:       string
  wallet:           string
  requested_amount: number
}

function validate(body: unknown): body is WithdrawPayload {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.deposit_id       === 'string' && b.deposit_id.length > 0 &&
    typeof b.wallet           === 'string' && (b.wallet as string).startsWith('0x') &&
    typeof b.requested_amount === 'number' && b.requested_amount > 0
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

  const { deposit_id, wallet, requested_amount } = body
  const walletLower = wallet.toLowerCase()

  const supabase = createSupabaseServiceClient()

  // ── Fetch deposit ───────────────────────────────────────────────────────
  const { data: deposit, error: depErr } = await supabase
    .from('lp_deposits')
    .select('id, vault_id, wallet, usdc_amount, lock_tier, deposited_at, locked_until, status')
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

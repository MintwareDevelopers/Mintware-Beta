// =============================================================================
// POST /api/claim/mark-claimed
//
// Called by ClaimCard after a successful on-chain claim tx.
// Verifies the tx succeeded and was from the correct wallet, then sets
// daily_payouts.claimed_at so the UI correctly reflects claimed status.
//
// Body: { wallet, distribution_id, tx_hash }
// Response 200: { ok: true }
// Response 400: missing fields
// Response 404: distribution or payout row not found
// Response 409: already marked claimed
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

// Simple JSON-RPC helper for tx verification
async function jsonRpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.error) return null
    return data.result ?? null
  } catch {
    return null
  }
}

function getRpcUrl(chain: string | null): string | null {
  if (!chain) return null
  switch (chain.toLowerCase()) {
    case 'base':         return process.env.BASE_RPC_URL         ?? 'https://mainnet.base.org'
    case 'base_sepolia': return process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
    case 'core_dao':     return process.env.CORE_DAO_RPC_URL     ?? 'https://rpc.coredao.org'
    case 'bnb':          return process.env.BNB_RPC_URL          ?? 'https://bsc-dataseed.binance.org'
    default:             return null
  }
}

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const { wallet, distribution_id, tx_hash } = (body ?? {}) as Record<string, unknown>
  if (!wallet || !distribution_id || !tx_hash || typeof wallet !== 'string' || typeof distribution_id !== 'string' || typeof tx_hash !== 'string') {
    return NextResponse.json({ error: 'wallet, distribution_id, and tx_hash are required' }, { status: 400 })
  }

  const walletLower = wallet.toLowerCase()
  const supabase = createSupabaseServiceClient()

  // Load the distribution to get campaign chain info
  const { data: dist } = await supabase
    .from('distributions')
    .select('id, campaign_id, epoch_number, campaigns(chain)')
    .eq('id', distribution_id)
    .single()

  if (!dist) {
    return NextResponse.json({ error: 'Distribution not found' }, { status: 404 })
  }

  // Check if already claimed
  const { data: payoutRow } = await supabase
    .from('daily_payouts')
    .select('id, claimed_at')
    .eq('campaign_id', dist.campaign_id)
    .eq('epoch_number', dist.epoch_number)
    .eq('wallet', walletLower)
    .maybeSingle()

  if (!payoutRow) {
    return NextResponse.json({ error: 'Wallet not found in this distribution' }, { status: 404 })
  }
  if (payoutRow.claimed_at) {
    return NextResponse.json({ ok: true, already_claimed: true })
  }

  // Verify tx on-chain — fail-open so RPC flakiness never blocks a real user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = Array.isArray(dist.campaigns) ? dist.campaigns[0] : (dist.campaigns as any)
  const rpcUrl = getRpcUrl(campaign?.chain ?? null)

  if (rpcUrl) {
    try {
      const receipt = await jsonRpcCall<{ status: string; from: string }>(
        rpcUrl, 'eth_getTransactionReceipt', [tx_hash]
      )
      if (receipt) {
        // Tx must have succeeded
        if (receipt.status !== '0x1') {
          return NextResponse.json({ error: 'Transaction did not succeed on-chain' }, { status: 400 })
        }
        // Tx must be from the claiming wallet
        if (receipt.from?.toLowerCase() !== walletLower) {
          return NextResponse.json({ error: 'Transaction sender does not match wallet' }, { status: 400 })
        }
      }
      // receipt=null means tx not found yet — fail-open, mark claimed anyway
    } catch {
      // RPC error — fail-open
    }
  }

  // Mark as claimed
  const now = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from('daily_payouts')
    .update({ claimed_at: now })
    .eq('id', payoutRow.id)

  if (updateErr) {
    console.error('[mark-claimed] update error:', updateErr.message)
    return NextResponse.json({ error: 'Failed to mark as claimed' }, { status: 500 })
  }

  console.log(`[mark-claimed] ✓ wallet=${walletLower} dist=${distribution_id} tx=${tx_hash}`)
  return NextResponse.json({ ok: true })
}

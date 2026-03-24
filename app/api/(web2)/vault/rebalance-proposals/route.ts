// GET /api/vault/rebalance-proposals?vault_id=<uuid>
//
// Returns pending (unexpired) RangeProposals for a vault.
// Used by the UI / keeper to fetch signed proposals ready for on-chain submission.
//
// Query params:
//   vault_id  — social_vaults UUID (required)
//   limit     — max rows to return (default 5, max 20)
//
// Auth: none (proposals are public — signature verification is on-chain)
//
// Response:
//   200 { proposals: SignedRangeProposalRow[] }
//   400 missing vault_id
//   500 DB error

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient }  from '@/lib/web2/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const vaultId = searchParams.get('vault_id')
  const rawLimit = searchParams.get('limit')

  if (!vaultId) {
    return NextResponse.json({ error: 'vault_id is required' }, { status: 400 })
  }

  const limit = Math.min(parseInt(rawLimit ?? '5', 10) || 5, 20)

  const supabase = createSupabaseServiceClient()
  const nowSecs  = Math.floor(Date.now() / 1000)

  const { data, error } = await supabase
    .from('vault_rebalance_proposals')
    .select('id, vault_id, tick_lower, tick_upper, reason, oracle_signature, signer_address, valid_until, nonce, status, created_at')
    .eq('vault_id', vaultId)
    .eq('status', 'pending')
    .gt('valid_until', nowSecs)       // only unexpired
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[rebalance-proposals] Supabase error:', error.message)
    return NextResponse.json({ error: 'Failed to fetch proposals' }, { status: 500 })
  }

  return NextResponse.json({ proposals: data ?? [] })
}

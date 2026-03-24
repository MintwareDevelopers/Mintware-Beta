// POST /api/vault/rebalance-proposals/mark-submitted
//
// Called by useRebalanceProposal after tx confirms on-chain.
// Updates proposal status to 'submitted' and records the tx hash.
//
// Body: { proposal_id: string, tx_hash: string }
//
// Auth: none (status change is idempotent; tx_hash is the on-chain receipt)

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { proposal_id?: string; tx_hash?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { proposal_id, tx_hash } = body

  if (!proposal_id) return NextResponse.json({ error: 'proposal_id required' }, { status: 400 })
  if (!tx_hash)     return NextResponse.json({ error: 'tx_hash required' },     { status: 400 })

  const supabase = createSupabaseServiceClient()

  const { error } = await supabase
    .from('vault_rebalance_proposals')
    .update({ status: 'submitted', submitted_tx: tx_hash })
    .eq('id', proposal_id)
    .eq('status', 'pending')     // only transition from pending → submitted

  if (error) {
    console.error('[mark-submitted] Supabase error:', error.message)
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

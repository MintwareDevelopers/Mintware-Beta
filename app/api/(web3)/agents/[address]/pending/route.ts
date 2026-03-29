// =============================================================================
// GET /api/agents/[address]/pending
// Returns unclaimed oracle-signed actions for an agent to submit to the contract.
// Public — the signature is bound to the agent's address via EIP-712, so it's
// only usable by that agent. No sensitive data is exposed.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params
  const address = raw?.toLowerCase()

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()
  const nowSecs  = Math.floor(Date.now() / 1000).toString()

  const { data, error } = await supabase
    .from('ai_pending_signatures')
    .select('id, tx_hash, signature, nonce, deadline, volume_wei, campaign_id')
    .eq('address', address)
    .eq('claimed', false)
    .gt('deadline', nowSecs)   // exclude expired signatures
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    console.error('[GET /api/agents/[address]/pending]', error.message)
    return NextResponse.json({ error: 'failed to load pending actions' }, { status: 500 })
  }

  const pending = (data ?? []).map(row => ({
    id:         row.id,
    txHash:     row.tx_hash,
    signature:  row.signature,
    nonce:      row.nonce,
    deadline:   row.deadline,
    volumeWei:  row.volume_wei,
    campaignId: row.campaign_id,
  }))

  return NextResponse.json({ pending, total: pending.length })
}

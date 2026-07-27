// GET /api/agents/[address]/pending
// Returns unclaimed oracle-signed actions for an agent.
// Auth: none (signatures are address-bound via EIP-712)

import { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address: raw } = await params
  return createHandler(async (_req, ctx) => {
    const address = raw?.toLowerCase()
    if (!address || !/^0x[0-9a-f]{40}$/.test(address)) return ctx.json({ error: 'invalid address' }, 400)

    const nowSecs = Math.floor(Date.now() / 1000).toString()

    const { data, error } = await ctx.supabase
      .from('ai_pending_signatures')
      .select('id, tx_hash, signature, nonce, deadline, volume_wei, campaign_id')
      .eq('address', address).eq('claimed', false).gt('deadline', nowSecs)
      .order('created_at', { ascending: true }).limit(50)

    if (error) {
      ctx.log.error('agents/pending', 'failed to load pending actions', { error: error.message })
      return ctx.json({ error: 'failed to load pending actions' }, 500)
    }

    const pending = (data ?? []).map((row: { id: string; tx_hash: string; signature: string; nonce: number; deadline: number; volume_wei: string; campaign_id: string }) => ({
      id: row.id, txHash: row.tx_hash, signature: row.signature,
      nonce: row.nonce, deadline: row.deadline, volumeWei: row.volume_wei, campaignId: row.campaign_id,
    }))

    return ctx.json({ pending, total: pending.length })
  })(req)
}

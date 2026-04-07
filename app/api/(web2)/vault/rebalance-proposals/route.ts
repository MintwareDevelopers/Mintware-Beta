// GET /api/vault/rebalance-proposals?vault_id=<uuid>
// Returns pending unexpired RangeProposals for a vault.
// Auth: none (signature verification is on-chain)

import { createHandler } from '@/lib/web2/routeHandler'

export const dynamic = 'force-dynamic'

export const GET = createHandler(async (req, ctx) => {
  const vaultId  = req.nextUrl.searchParams.get('vault_id')
  const rawLimit = req.nextUrl.searchParams.get('limit')

  if (!vaultId) return ctx.json({ error: 'vault_id is required' }, 400)

  const limit   = Math.min(parseInt(rawLimit ?? '5', 10) || 5, 20)
  const nowSecs = Math.floor(Date.now() / 1000)

  const { data, error } = await ctx.supabase
    .from('vault_rebalance_proposals')
    .select('id, vault_id, tick_lower, tick_upper, reason, oracle_signature, signer_address, valid_until, nonce, status, created_at')
    .eq('vault_id', vaultId).eq('status', 'pending').gt('valid_until', nowSecs)
    .order('created_at', { ascending: false }).limit(limit)

  if (error) {
    ctx.log.error('rebalance-proposals', 'Supabase error', { error: error.message })
    return ctx.json({ error: 'Failed to fetch proposals' }, 500)
  }

  return ctx.json({ proposals: data ?? [] })
})

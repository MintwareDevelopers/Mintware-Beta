// GET /api/claim/sol?campaign_id=&epoch_number=&wallet=
// Returns oracle signature + Merkle proof for a Solana claim.

import { createHandler } from '@/lib/web2/routeHandler'
import { getOraclePublicKey } from '@/lib/web3/solanaPublisher'

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export const GET = createHandler(async (req, ctx) => {
  const { searchParams } = req.nextUrl
  const campaignId  = searchParams.get('campaign_id')
  const epochStr    = searchParams.get('epoch_number')
  const wallet      = searchParams.get('wallet')

  if (!campaignId || !epochStr || !wallet) return ctx.json({ error: 'campaign_id, epoch_number, and wallet are required' }, 400)
  if (!SOLANA_RE.test(wallet)) return ctx.json({ error: 'invalid wallet address' }, 422)

  const epochNumber = parseInt(epochStr, 10)
  if (isNaN(epochNumber) || epochNumber < 1) return ctx.json({ error: 'invalid epoch_number' }, 422)

  const { data: dist, error: distErr } = await ctx.supabase
    .from('sol_distributions')
    .select('merkle_root, tree_json, oracle_sig, deadline, status')
    .eq('campaign_id', campaignId)
    .eq('epoch_number', epochNumber)
    .maybeSingle()

  if (distErr) {
    ctx.log.error('claim/sol', 'DB error', { error: distErr.message })
    return ctx.json({ error: 'database error' }, 500)
  }
  if (!dist) return ctx.json({ error: 'distribution not found' }, 404)
  if (dist.status === 'pending') return ctx.json({ error: 'distribution not yet published' }, 404)
  if (!dist.deadline) {
    ctx.log.error('claim/sol', 'null deadline', { campaignId, epochNumber })
    return ctx.json({ error: 'distribution deadline not set' }, 500)
  }

  const tree = dist.tree_json as { root: string; leaves: Array<{ wallet: string; amount: string; proof: string[] }> }
  const leaf = tree.leaves?.find((l) => l.wallet.toLowerCase() === wallet.toLowerCase() || l.wallet === wallet)
  if (!leaf) return ctx.json({ error: 'wallet not found in this distribution' }, 404)

  let oraclePubkey: string
  try {
    oraclePubkey = getOraclePublicKey()
  } catch (err) {
    ctx.log.error('claim/sol', 'oracle key error', { error: String(err) })
    return ctx.json({ error: 'oracle configuration error' }, 500)
  }

  return ctx.json({ merkle_root: dist.merkle_root, oracle_sig: dist.oracle_sig, deadline: dist.deadline, epoch_number: epochNumber, amount: leaf.amount, proof: leaf.proof, oracle_pubkey: oraclePubkey })
})

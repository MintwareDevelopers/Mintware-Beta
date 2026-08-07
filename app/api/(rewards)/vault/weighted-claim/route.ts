// GET /api/vault/weighted-claim?vault_id=&epoch=&wallet=
//
// Serves a wallet's claim (amount0, amount1, Merkle proof) for a closed weighted vault
// epoch, from the tree persisted by the vault-weighted-epoch-close cron. Public read —
// proofs are non-sensitive; the on-chain claim is what moves value, and only the leaf
// owner (msg.sender) can claim their leaf.
//
// Persisted shape (table `vault_weighted_epochs`, one row per (vault_id, epoch_number)):
//   merkle_root text, total0_wei text, total1_wei text, deadline bigint,
//   claim_index jsonb  // { "<wallet>": { amount0Wei, amount1Wei, proof: string[] } }

import { createHandler } from '@/lib/web2/routeHandler'

export const dynamic = 'force-dynamic'

export const GET = createHandler(async (req, ctx) => {
  const vaultId = req.nextUrl.searchParams.get('vault_id')
  const epoch   = req.nextUrl.searchParams.get('epoch')
  const wallet  = req.nextUrl.searchParams.get('wallet')?.toLowerCase()

  if (!vaultId || !epoch || !wallet) {
    return ctx.json({ error: 'Missing vault_id, epoch, or wallet' }, 400)
  }

  const { data: row, error } = await ctx.supabase
    .from('vault_weighted_epochs')
    .select('merkle_root, total0_wei, total1_wei, deadline, claim_index')
    .eq('vault_id', vaultId)
    .eq('epoch_number', Number(epoch))
    .maybeSingle()

  if (error)  return ctx.json({ error: 'lookup failed' }, 500)
  if (!row)   return ctx.json({ error: 'epoch not found or not yet closed' }, 404)

  const claim = (row.claim_index as Record<string, unknown> | null)?.[wallet]
  if (!claim) {
    // Wallet not in this epoch's tree — no allocation (not an error).
    return ctx.json({
      vault_id: vaultId, epoch_number: Number(epoch), wallet,
      claimable: false, merkle_root: row.merkle_root, deadline: row.deadline,
    })
  }

  return ctx.json({
    vault_id: vaultId,
    epoch_number: Number(epoch),
    wallet,
    claimable: true,
    merkle_root: row.merkle_root,
    deadline: row.deadline,
    claim, // { amount0Wei, amount1Wei, proof }
  })
})

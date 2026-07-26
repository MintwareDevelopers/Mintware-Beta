// POST /api/vault/rebalance-proposals/mark-submitted
// Updates proposal status to 'submitted' after on-chain tx confirms.
// Auth: none (status change is idempotent; tx_hash is the on-chain receipt)

import { createHandler } from '@/lib/web2/routeHandler'
import { createPublicClient, decodeFunctionData, http, keccak256, toBytes } from 'viem'
import { base, baseSepolia } from 'viem/chains'

export const dynamic = 'force-dynamic'

const REBALANCE_WITH_PROPOSAL_ABI = [
  {
    name: 'rebalanceWithProposal', type: 'function',
    inputs: [
      { name: 'vaultId', type: 'bytes32' }, { name: 'newTickLower', type: 'int24' },
      { name: 'newTickUpper', type: 'int24' }, { name: 'validUntil', type: 'uint256' },
      { name: 'nonce', type: 'uint256' }, { name: 'oracleSignature', type: 'bytes' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
] as const

async function findVerifiedRebalanceTx(txHash: `0x${string}`) {
  const socialVaultAddress = (process.env.NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS ?? '').toLowerCase()
  if (!socialVaultAddress) return null

  const clients = [
    createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? 'https://mainnet.base.org') }),
    createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org') }),
  ]

  for (const client of clients) {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash }).catch(() => null),
      client.getTransactionReceipt({ hash: txHash }).catch(() => null),
    ])
    if (!tx || !receipt || receipt.status !== 'success') continue
    if ((tx.to ?? '').toLowerCase() !== socialVaultAddress) continue
    const decoded = decodeFunctionData({ abi: REBALANCE_WITH_PROPOSAL_ABI, data: tx.input })
    if (decoded.functionName !== 'rebalanceWithProposal') continue
    return { tx, receipt, decoded }
  }
  return null
}

export const POST = createHandler(async (req, ctx) => {
  let body: { proposal_id?: string; tx_hash?: string }
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'Invalid JSON' }, 400) }

  const { proposal_id, tx_hash } = body
  if (!proposal_id) return ctx.json({ error: 'proposal_id required' }, 400)
  if (!tx_hash)     return ctx.json({ error: 'tx_hash required' }, 400)

  const { data: proposal, error: proposalError } = await ctx.supabase
    .from('vault_rebalance_proposals')
    .select('id, vault_id, tick_lower, tick_upper, valid_until, nonce, oracle_signature, status')
    .eq('id', proposal_id).single()

  if (proposalError || !proposal) return ctx.json({ error: 'proposal not found' }, 404)
  if (proposal.status !== 'pending') return ctx.json({ error: 'proposal is not pending' }, 409)

  const verified = await findVerifiedRebalanceTx(tx_hash as `0x${string}`)
  if (!verified) return ctx.json({ error: 'rebalance transaction not yet verifiable' }, 409)

  const vaultIdBytes32 = keccak256(toBytes(proposal.vault_id)) as `0x${string}`
  const [vaultId, tickLower, tickUpper, validUntil, nonce, oracleSignature] = verified.decoded.args

  if (vaultId !== vaultIdBytes32) return ctx.json({ error: 'proposal vault mismatch' }, 403)
  if (Number(tickLower) !== proposal.tick_lower || Number(tickUpper) !== proposal.tick_upper) return ctx.json({ error: 'proposal tick range mismatch' }, 403)
  if (Number(validUntil) !== proposal.valid_until || Number(nonce) !== proposal.nonce) return ctx.json({ error: 'proposal timing mismatch' }, 403)
  if ((oracleSignature as string).toLowerCase() !== proposal.oracle_signature.toLowerCase()) return ctx.json({ error: 'proposal signature mismatch' }, 403)

  const { error } = await ctx.supabase
    .from('vault_rebalance_proposals')
    .update({ status: 'submitted', submitted_tx: tx_hash })
    .eq('id', proposal_id).eq('status', 'pending')

  if (error) {
    ctx.log.error('mark-submitted', 'Supabase error', { error: error.message })
    return ctx.json({ error: 'DB update failed' }, 500)
  }

  return ctx.json({ ok: true })
})

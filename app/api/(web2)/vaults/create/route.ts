// POST /api/vaults — create a new social vault record
// Auth: inline signed-message (buildVaultCreateMessage format)

import { createHandler } from '@/lib/web2/routeHandler'
import { recoverMessageAddress } from 'viem'
import { buildVaultCreateMessage } from '@/lib/web3/signedActionMessages'

interface CreateVaultPayload {
  name: string; team_wallet: string; project_token: string; seed_amount: number
  pool_key: Record<string, unknown>; chain_id: number; contract_address: string | null
  status: string; issuedAt?: number; authMessage?: string; authSignature?: `0x${string}`
}

const MAX_AUTH_AGE_MS = 15 * 60 * 1000

function validate(b: unknown): b is CreateVaultPayload {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.name === 'string' && p.name.length > 0 &&
    typeof p.team_wallet === 'string' && (p.team_wallet as string).startsWith('0x') &&
    typeof p.project_token === 'string' && (p.project_token as string).startsWith('0x') &&
    typeof p.seed_amount === 'number' && p.seed_amount > 0 &&
    typeof p.pool_key === 'object' && p.pool_key !== null &&
    typeof p.chain_id === 'number'
  )
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'Invalid JSON' }, 400) }
  if (!validate(body)) return ctx.json({ error: 'Invalid request body' }, 400)

  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number')
    return ctx.json({ error: 'Signed authorization required' }, 401)
  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS)
    return ctx.json({ error: 'Authorization expired' }, 401)

  const expectedMessage = buildVaultCreateMessage({
    teamWallet: body.team_wallet, issuedAt: body.issuedAt, name: body.name,
    projectToken: body.project_token, seedAmount: body.seed_amount, chainId: body.chain_id,
    poolKey: {
      currency0: String(body.pool_key.currency0 ?? ''), currency1: String(body.pool_key.currency1 ?? ''),
      fee: Number(body.pool_key.fee ?? 0), tickSpacing: Number(body.pool_key.tickSpacing ?? 0),
      hooks: String(body.pool_key.hooks ?? ''),
    },
  })
  if (body.authMessage !== expectedMessage) return ctx.json({ error: 'Authorization payload mismatch' }, 401)

  const signer = await recoverMessageAddress({ message: body.authMessage, signature: body.authSignature }).catch(() => null)
  if (!signer || signer.toLowerCase() !== body.team_wallet.toLowerCase()) return ctx.json({ error: 'Invalid authorization signature' }, 401)

  const { data, error } = await ctx.supabase
    .from('social_vaults')
    .insert({
      name: body.name, team_wallet: body.team_wallet.toLowerCase(), project_token: body.project_token.toLowerCase(),
      seed_amount: body.seed_amount, pool_key: body.pool_key, chain_id: body.chain_id,
      contract_address: body.contract_address ?? null, status: body.status ?? 'seeding', tvl_usdc: 0,
    })
    .select('id, name, status').single()

  if (error || !data) {
    ctx.log.error('vaults/create', 'insert failed', { error: error?.message })
    return ctx.json({ error: 'Failed to create vault' }, 500)
  }

  await ctx.supabase.from('vault_epochs').insert({ vault_id: data.id, epoch_number: 1, total_pool: 0, bonus_pool: 0, status: 'active' })

  return ctx.json({ id: data.id, name: data.name, status: data.status }, 201)
})

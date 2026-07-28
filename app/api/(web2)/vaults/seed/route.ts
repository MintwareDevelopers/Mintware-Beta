// GET  /api/vaults/seed?vault_id=…  — the vault's seed config + progress + fill%
// POST /api/vaults/seed              — open a seed for a vault (signed by team)
//
// The escrow lives on-chain (MintwareSeedPool). These endpoints hold the config
// so the UI can render the raise, and mirror on-chain progress.

import { createHandler } from '@/lib/web2/routeHandler'
import { recoverMessageAddress } from 'viem'
import { buildSeedOpenMessage } from '@/lib/web3/signedActionMessages'

const MAX_AUTH_AGE_MS = 15 * 60 * 1000

export const GET = createHandler(async (req, ctx) => {
  const vaultId = req.nextUrl.searchParams.get('vault_id')
  if (!vaultId) return ctx.json({ error: 'vault_id required' }, 400)

  const { data: seed } = await ctx.supabase.from('vault_seeding').select('*').eq('vault_id', vaultId).maybeSingle()
  if (!seed) return ctx.json({ seed: null })

  const { data: contributions } = await ctx.supabase
    .from('seed_contributions').select('contributor, amount, tx_hash, refunded, created_at')
    .eq('seeding_id', seed.id).order('created_at', { ascending: false })

  const target = Number(seed.quote_target ?? 0)
  const raised = Number(seed.quote_raised ?? 0)
  const fillPct = target > 0 ? Math.min(100, (raised / target) * 100) : 0
  const thresholdPct = target > 0 ? (Number(seed.threshold ?? 0) / target) * 100 : 0

  return ctx.json({ seed, contributions: contributions ?? [], fillPct, thresholdPct, thresholdMet: raised >= Number(seed.threshold ?? 0) })
})

interface OpenPayload {
  vault_id: string
  team_wallet: string
  chain_id: number
  project_token: string
  quote_token: string
  target_address?: string
  token_reserve: number
  team_quote?: number
  public_quote_target: number
  deploy_threshold_bps: number
  raise_deadline: string // ISO
  sqrt_price?: string
  contract_address?: string
  seed_id?: string
  issuedAt?: number
  authMessage?: string
  authSignature?: `0x${string}`
}

function validate(b: unknown): b is OpenPayload {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.vault_id === 'string' && p.vault_id.length > 0 &&
    typeof p.team_wallet === 'string' && (p.team_wallet as string).startsWith('0x') &&
    typeof p.chain_id === 'number' &&
    typeof p.project_token === 'string' && (p.project_token as string).startsWith('0x') &&
    typeof p.quote_token === 'string' && (p.quote_token as string).startsWith('0x') &&
    typeof p.token_reserve === 'number' && p.token_reserve > 0 &&
    typeof p.public_quote_target === 'number' && p.public_quote_target > 0 &&
    typeof p.deploy_threshold_bps === 'number' && p.deploy_threshold_bps > 0 && p.deploy_threshold_bps <= 10_000 &&
    typeof p.raise_deadline === 'string'
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

  const expected = buildSeedOpenMessage({ teamWallet: body.team_wallet, issuedAt: body.issuedAt, vaultId: body.vault_id, chainId: body.chain_id })
  if (body.authMessage !== expected) return ctx.json({ error: 'Authorization payload mismatch' }, 401)

  const signer = await recoverMessageAddress({ message: body.authMessage, signature: body.authSignature }).catch(() => null)
  if (!signer || signer.toLowerCase() !== body.team_wallet.toLowerCase())
    return ctx.json({ error: 'Invalid authorization signature' }, 401)

  // Only the vault's team_wallet can open its seed.
  const { data: vault } = await ctx.supabase.from('social_vaults').select('id, team_wallet').eq('id', body.vault_id).maybeSingle()
  if (!vault) return ctx.json({ error: 'Unknown vault' }, 400)
  if (String(vault.team_wallet).toLowerCase() !== body.team_wallet.toLowerCase())
    return ctx.json({ error: 'Only the vault team can open a seed' }, 403)

  const teamQuote = body.team_quote ?? 0
  const quoteTarget = teamQuote + body.public_quote_target
  const threshold = (quoteTarget * body.deploy_threshold_bps) / 10_000

  const { data, error } = await ctx.supabase
    .from('vault_seeding')
    .insert({
      vault_id: body.vault_id, seed_id: body.seed_id ?? null,
      project_token: body.project_token.toLowerCase(), quote_token: body.quote_token.toLowerCase(),
      target_address: body.target_address ?? null,
      token_reserve: body.token_reserve, team_quote: teamQuote, public_quote_target: body.public_quote_target,
      quote_target: quoteTarget, quote_raised: teamQuote, deploy_threshold_bps: body.deploy_threshold_bps,
      threshold, raise_deadline: body.raise_deadline, sqrt_price: body.sqrt_price ?? null,
      chain_id: body.chain_id, contract_address: body.contract_address ?? null, phase: 'seeding',
    })
    .select('id').single()

  if (error || !data) {
    ctx.log.error('vaults/seed', 'open failed', { error: error?.message })
    return ctx.json({ error: error?.message?.includes('duplicate') ? 'Vault already has a seed' : 'Failed to open seed' }, 500)
  }

  ctx.log.info('vaults/seed', 'seed opened', { vaultId: body.vault_id, seedingId: data.id })
  return ctx.json({ id: data.id, quote_target: quoteTarget, threshold, phase: 'seeding' }, 201)
})

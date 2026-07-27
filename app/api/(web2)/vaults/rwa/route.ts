// POST /api/vaults/rwa — create an RWA vault + deal + data-room documents.
// No on-chain deploy (RWA contracts are testnet-gated); this persists a deal
// draft that enters Mintware review. Auth: inline signed-message (issuer wallet).

import { createHandler } from '@/lib/web2/routeHandler'
import { recoverMessageAddress } from 'viem'
import { buildRwaDealMessage } from '@/lib/web3/signedActionMessages'

interface DocInput { label: string; url: string; kind?: string }
interface RwaDealPayload {
  name: string
  issuer_wallet: string
  issuer_id: string
  chain_id: number
  description?: string
  yield_source_explainer?: string
  price_explainer?: string
  underlying_asset_class?: string
  target_apy_pct?: number
  min_investment_usd?: number
  reserve_pct?: number
  yield_pct?: number
  price_band?: string
  settle_days?: number
  kyc_tier_required?: string
  documents?: DocInput[]
  issuedAt?: number
  authMessage?: string
  authSignature?: `0x${string}`
}

const MAX_AUTH_AGE_MS = 15 * 60 * 1000
const DOC_KINDS = ['term_sheet', 'legal_opinion', 'spv_structure', 'audit', 'data_room', 'other']
const KYC_TIERS = ['NONE', 'BASIC', 'ACCREDITED', 'INSTITUTIONAL']

function validate(b: unknown): b is RwaDealPayload {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.name === 'string' && p.name.length > 0 &&
    typeof p.issuer_wallet === 'string' && (p.issuer_wallet as string).startsWith('0x') &&
    typeof p.issuer_id === 'string' && (p.issuer_id as string).length > 0 &&
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

  const expected = buildRwaDealMessage({
    issuerWallet: body.issuer_wallet, issuedAt: body.issuedAt,
    name: body.name, issuerId: body.issuer_id, chainId: body.chain_id,
  })
  if (body.authMessage !== expected) return ctx.json({ error: 'Authorization payload mismatch' }, 401)

  const signer = await recoverMessageAddress({ message: body.authMessage, signature: body.authSignature }).catch(() => null)
  if (!signer || signer.toLowerCase() !== body.issuer_wallet.toLowerCase())
    return ctx.json({ error: 'Invalid authorization signature' }, 401)

  // Issuer must exist + be VERIFIED to publish a deal.
  const { data: issuer } = await ctx.supabase
    .from('vault_issuers').select('id, status').eq('id', body.issuer_id).maybeSingle()
  if (!issuer) return ctx.json({ error: 'Unknown issuer' }, 400)
  if (issuer.status !== 'VERIFIED')
    return ctx.json({ error: 'Issuer must be VERIFIED before publishing a deal' }, 403)

  // 1) vault row (RWA, ERC-4626, draft — no on-chain seed yet)
  const { data: vault, error: vErr } = await ctx.supabase
    .from('social_vaults')
    .insert({
      name: body.name, team_wallet: body.issuer_wallet.toLowerCase(),
      surface: 'rwa', vault_standard: 'erc4626', provider: body.issuer_id,
      status: 'seeding', chain_id: body.chain_id, tvl_usdc: 0,
    })
    .select('id').single()
  if (vErr || !vault) {
    ctx.log.error('vaults/rwa', 'vault insert failed', { error: vErr?.message })
    return ctx.json({ error: 'Failed to create vault' }, 500)
  }

  // 2) deal (enters review)
  const kyc = KYC_TIERS.includes(String(body.kyc_tier_required)) ? body.kyc_tier_required : 'BASIC'
  const { data: deal, error: dErr } = await ctx.supabase
    .from('vault_deals')
    .insert({
      vault_id: vault.id, issuer_id: body.issuer_id,
      description: body.description ?? null,
      yield_source_explainer: body.yield_source_explainer ?? null,
      price_explainer: body.price_explainer ?? null,
      underlying_asset_class: body.underlying_asset_class ?? null,
      target_apy_pct: body.target_apy_pct ?? null,
      min_investment_usd: body.min_investment_usd ?? 0,
      reserve_pct: body.reserve_pct ?? 40,
      yield_pct: body.yield_pct ?? 60,
      price_band: body.price_band ?? '±15/±45',
      settle_days: body.settle_days ?? 30,
      kyc_tier_required: kyc,
      review_status: 'in_review',
    })
    .select('id').single()
  if (dErr || !deal) {
    ctx.log.error('vaults/rwa', 'deal insert failed', { error: dErr?.message })
    return ctx.json({ error: 'Failed to create deal' }, 500)
  }

  // 3) data-room documents (each enters review)
  const docs = Array.isArray(body.documents) ? body.documents.filter(d => d?.label && d?.url) : []
  if (docs.length > 0) {
    await ctx.supabase.from('vault_deal_documents').insert(
      docs.map((d, i) => ({
        deal_id: deal.id, label: d.label, url: d.url,
        kind: DOC_KINDS.includes(String(d.kind)) ? d.kind : 'other',
        review_status: 'pending', sort_order: i,
      }))
    )
  }

  ctx.log.info('vaults/rwa', 'RWA deal created', { vaultId: vault.id, dealId: deal.id, issuer: body.issuer_id })
  return ctx.json({ vault_id: vault.id, deal_id: deal.id, review_status: 'in_review' }, 201)
})

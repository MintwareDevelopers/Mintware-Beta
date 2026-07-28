// GET  /api/vaults/redemptions?holder=0x…  — a holder's redemption requests
// POST /api/vaults/redemptions                — request a redemption (signed by holder)
//
// A redemption request is the off-chain intent ledger mirroring
// MintwareRWAVault4626.requestRedeem → 30-day window → confirmSettlement.

import { createHandler } from '@/lib/web2/routeHandler'
import { recoverMessageAddress } from 'viem'
import { buildRedeemRequestMessage } from '@/lib/web3/signedActionMessages'

const MAX_AUTH_AGE_MS = 15 * 60 * 1000

export const GET = createHandler(async (req, ctx) => {
  const holder = req.nextUrl.searchParams.get('holder')
  if (!holder || !/^0x[0-9a-fA-F]{40}$/.test(holder)) return ctx.json({ error: 'valid holder required' }, 400)
  const { getRedemptions } = await import('@/lib/rwa/redemptions')
  const redemptions = await getRedemptions(holder)
  return ctx.json({ redemptions })
})

interface RedeemPayload {
  vault_id: string
  holder: string
  shares_usd: number
  issuedAt?: number
  authMessage?: string
  authSignature?: `0x${string}`
}

function validate(b: unknown): b is RedeemPayload {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.vault_id === 'string' && p.vault_id.length > 0 &&
    typeof p.holder === 'string' && (p.holder as string).startsWith('0x') &&
    typeof p.shares_usd === 'number' && p.shares_usd > 0
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

  const expected = buildRedeemRequestMessage({ vaultId: body.vault_id, wallet: body.holder, sharesUsd: body.shares_usd, issuedAt: body.issuedAt })
  if (body.authMessage !== expected) return ctx.json({ error: 'Authorization payload mismatch' }, 401)

  const signer = await recoverMessageAddress({ message: body.authMessage, signature: body.authSignature }).catch(() => null)
  if (!signer || signer.toLowerCase() !== body.holder.toLowerCase())
    return ctx.json({ error: 'Invalid authorization signature' }, 401)

  // Only RWA vaults are redeemable; pull settle_days from the deal (default 30).
  const { data: vault } = await ctx.supabase.from('social_vaults').select('id, surface').eq('id', body.vault_id).maybeSingle()
  if (!vault || vault.surface !== 'rwa') return ctx.json({ error: 'Not an RWA vault' }, 400)
  const { data: deal } = await ctx.supabase.from('vault_deals').select('settle_days').eq('vault_id', body.vault_id).maybeSingle()
  const settleDays = Number(deal?.settle_days ?? 30)

  const today = new Date(body.issuedAt)
  const settles = new Date(body.issuedAt + settleDays * 86_400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const { data, error } = await ctx.supabase
    .from('vault_redemptions')
    .insert({
      vault_id: body.vault_id, holder: body.holder.toLowerCase(), shares_usd: body.shares_usd,
      requested_at: iso(today), settles_at: iso(settles), status: 'pending', kyc_verified: false,
    })
    .select('id').single()
  if (error || !data) {
    ctx.log.error('redemptions', 'insert failed', { error: error?.message })
    return ctx.json({ error: 'Failed to create redemption request' }, 500)
  }

  ctx.log.info('redemptions', 'requested', { id: data.id, vault: body.vault_id })
  return ctx.json({ id: data.id, status: 'pending', settles_at: iso(settles) }, 201)
})

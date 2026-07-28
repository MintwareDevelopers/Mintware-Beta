// POST /api/vaults/issuers/register — self-serve issuer registration.
// Signed by the issuer wallet. Creates a vault_issuers row with status REGISTERED
// (enters the admin review queue for verification). Auth: inline signed-message.

import { createHandler } from '@/lib/web2/routeHandler'
import { recoverMessageAddress } from 'viem'
import { buildIssuerRegisterMessage } from '@/lib/web3/signedActionMessages'

interface RegisterPayload {
  id: string
  name: string
  wallet: string
  since?: string
  transparency?: { label: string; value: string }[]
  links?: { label: string; url: string }[]
  issuedAt?: number
  authMessage?: string
  authSignature?: `0x${string}`
}

const MAX_AUTH_AGE_MS = 15 * 60 * 1000
const SLUG = /^[a-z0-9-]{2,40}$/

function validate(b: unknown): b is RegisterPayload {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.id === 'string' && SLUG.test(p.id) &&
    typeof p.name === 'string' && p.name.length > 0 &&
    typeof p.wallet === 'string' && (p.wallet as string).startsWith('0x')
  )
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'Invalid JSON' }, 400) }
  if (!validate(body)) return ctx.json({ error: 'Invalid request body (id must be a slug)' }, 400)

  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number')
    return ctx.json({ error: 'Signed authorization required' }, 401)
  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS)
    return ctx.json({ error: 'Authorization expired' }, 401)

  const expected = buildIssuerRegisterMessage({ wallet: body.wallet, issuedAt: body.issuedAt, id: body.id, name: body.name })
  if (body.authMessage !== expected) return ctx.json({ error: 'Authorization payload mismatch' }, 401)

  const signer = await recoverMessageAddress({ message: body.authMessage, signature: body.authSignature }).catch(() => null)
  if (!signer || signer.toLowerCase() !== body.wallet.toLowerCase())
    return ctx.json({ error: 'Invalid authorization signature' }, 401)

  // Reject if the slug is taken (by anyone).
  const { data: existing } = await ctx.supabase.from('vault_issuers').select('id').eq('id', body.id).maybeSingle()
  if (existing) return ctx.json({ error: 'That issuer id is already taken — pick a different name' }, 409)

  const { error } = await ctx.supabase.from('vault_issuers').insert({
    id: body.id,
    name: body.name,
    address: body.wallet.toLowerCase(),
    status: 'REGISTERED',
    since: body.since ?? null,
    transparency: Array.isArray(body.transparency) ? body.transparency.filter(t => t?.label && t?.value) : [],
    links: Array.isArray(body.links) ? body.links.filter(l => l?.label && l?.url) : [],
  })
  if (error) {
    ctx.log.error('issuers/register', 'insert failed', { id: body.id, error: error.message })
    return ctx.json({ error: 'Failed to register issuer' }, 500)
  }

  ctx.log.info('issuers/register', 'registered', { id: body.id, wallet: body.wallet.toLowerCase() })
  return ctx.json({ id: body.id, status: 'REGISTERED' }, 201)
})

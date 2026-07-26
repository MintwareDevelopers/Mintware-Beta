// POST /api/agents/mwp — submit MWP folder snapshot hash
// Auth: inline signed-message (buildAgentMwpMessage format)

import { createHandler } from '@/lib/web2/routeHandler'
import { recoverMessageAddress } from 'viem'
import { buildAgentMwpMessage } from '@/lib/web3/signedActionMessages'

const MAX_AUTH_AGE_MS = 15 * 60 * 1000

export const POST = createHandler(async (req, ctx) => {
  let body: { address?: string; mwpHash?: string; authMessage?: string; authSignature?: `0x${string}`; issuedAt?: number }
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'invalid json' }, 400) }

  const address = body.address?.toLowerCase()
  const mwpHash = body.mwpHash?.toLowerCase()

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) return ctx.json({ error: 'invalid address' }, 400)
  if (!mwpHash || !/^0x[0-9a-f]{64}$/.test(mwpHash)) return ctx.json({ error: 'invalid mwp hash — must be 0x-prefixed 32-byte hex' }, 400)
  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number') return ctx.json({ error: 'signed authorization is required' }, 401)
  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS) return ctx.json({ error: 'authorization expired' }, 401)

  const expectedMessage = buildAgentMwpMessage({ address, mwpHash, issuedAt: body.issuedAt })
  if (body.authMessage !== expectedMessage) return ctx.json({ error: 'authorization payload mismatch' }, 401)

  const signer = await recoverMessageAddress({ message: body.authMessage, signature: body.authSignature }).catch(() => null)
  if (!signer || signer.toLowerCase() !== address) return ctx.json({ error: 'invalid authorization signature' }, 401)

  const { data: profile } = await ctx.supabase.from('ai_agent_profiles').select('address').eq('address', address).maybeSingle()
  if (!profile) return ctx.json({ error: 'agent not registered' }, 404)

  const { error: hashErr } = await ctx.supabase.from('ai_agent_mwp_hashes').insert({ address, mwp_hash: mwpHash })
  if (hashErr) {
    if (hashErr.code === '23505') return ctx.json({ error: 'hash already submitted' }, 409)
    ctx.log.error('agents/mwp', 'insert failed', { error: hashErr.message })
    return ctx.json({ error: 'submission failed' }, 500)
  }

  const { data: score } = await ctx.supabase.from('ai_agent_scores').select('interpretability, mwp_submissions').eq('address', address).maybeSingle()
  const current  = Number(score?.interpretability ?? 0)
  const bonus    = Math.min(50, Math.max(0, 500 - current))
  const newCount = (score?.mwp_submissions ?? 0) + 1

  await ctx.supabase.from('ai_agent_scores').update({ interpretability: current + bonus, mwp_submissions: newCount, is_transparent: true, last_mwp_hash: mwpHash }).eq('address', address)

  return ctx.json({ ok: true, bonus, newCount })
})

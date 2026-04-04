// =============================================================================
// POST /api/agents/mwp — submit MWP folder snapshot hash (permissionless)
// Mirrors submitMwpHash() in AIAttribution.sol. Interpretability capped at 500.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { recoverMessageAddress } from 'viem'
import { buildAgentMwpMessage } from '@/lib/web3/signedActionMessages'

const MAX_AUTH_AGE_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  let body: {
    address?: string
    mwpHash?: string
    authMessage?: string
    authSignature?: `0x${string}`
    issuedAt?: number
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const address = body.address?.toLowerCase()
  const mwpHash = body.mwpHash?.toLowerCase()

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }
  if (!mwpHash || !/^0x[0-9a-f]{64}$/.test(mwpHash)) {
    return NextResponse.json({ error: 'invalid mwp hash — must be 0x-prefixed 32-byte hex' }, { status: 400 })
  }
  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number') {
    return NextResponse.json({ error: 'signed authorization is required' }, { status: 401 })
  }
  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS) {
    return NextResponse.json({ error: 'authorization expired' }, { status: 401 })
  }

  const expectedMessage = buildAgentMwpMessage({
    address,
    mwpHash,
    issuedAt: body.issuedAt,
  })
  if (body.authMessage !== expectedMessage) {
    return NextResponse.json({ error: 'authorization payload mismatch' }, { status: 401 })
  }

  const signer = await recoverMessageAddress({
    message: body.authMessage,
    signature: body.authSignature,
  }).catch(() => null)
  if (!signer || signer.toLowerCase() !== address) {
    return NextResponse.json({ error: 'invalid authorization signature' }, { status: 401 })
  }

  const supabase = createSupabaseServiceClient()

  const { data: profile } = await supabase
    .from('ai_agent_profiles').select('address').eq('address', address).maybeSingle()
  if (!profile) return NextResponse.json({ error: 'agent not registered' }, { status: 404 })

  const { error: hashErr } = await supabase
    .from('ai_agent_mwp_hashes').insert({ address, mwp_hash: mwpHash })
  if (hashErr) {
    if (hashErr.code === '23505') return NextResponse.json({ error: 'hash already submitted' }, { status: 409 })
    console.error('[POST /api/agents/mwp]', hashErr.message)
    return NextResponse.json({ error: 'submission failed' }, { status: 500 })
  }

  const { data: score } = await supabase
    .from('ai_agent_scores').select('interpretability, mwp_submissions').eq('address', address).maybeSingle()

  const current  = Number(score?.interpretability ?? 0)
  const bonus    = Math.min(50, Math.max(0, 500 - current))
  const newCount = (score?.mwp_submissions ?? 0) + 1

  await supabase.from('ai_agent_scores').update({
    interpretability: current + bonus,
    mwp_submissions:  newCount,
    is_transparent:   true,
    last_mwp_hash:    mwpHash,
  }).eq('address', address)

  return NextResponse.json({ ok: true, bonus, newCount })
}

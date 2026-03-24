// =============================================================================
// POST /api/agents/mwp — submit a MWP folder snapshot hash for an agent
// Permissionless — any registered agent can call this.
// Mirrors the on-chain submitMwpHash() function in AIAttribution.sol.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function POST(req: NextRequest) {
  let body: { address?: string; mwpHash?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const address = body.address?.toLowerCase()
  const mwpHash = body.mwpHash?.toLowerCase()

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }
  if (!mwpHash || !/^0x[0-9a-f]{64}$/.test(mwpHash)) {
    return NextResponse.json({ error: 'invalid mwp hash — must be 0x-prefixed 32-byte hex' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  // Check agent is registered
  const { data: profile } = await supabase
    .from('ai_agent_profiles')
    .select('address')
    .eq('address', address)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json({ error: 'agent not registered' }, { status: 404 })
  }

  // Insert hash (unique constraint prevents duplicates)
  const { error: hashErr } = await supabase
    .from('ai_agent_mwp_hashes')
    .insert({ address, mwp_hash: mwpHash })

  if (hashErr) {
    if (hashErr.code === '23505') {
      return NextResponse.json({ error: 'hash already submitted' }, { status: 409 })
    }
    console.error('[POST /api/agents/mwp]', hashErr.message)
    return NextResponse.json({ error: 'submission failed' }, { status: 500 })
  }

  // Update score: interpretability += 50 (cap at 500), is_transparent = true
  const { data: score } = await supabase
    .from('ai_agent_scores')
    .select('interpretability, mwp_submissions')
    .eq('address', address)
    .maybeSingle()

  const currentInterp  = Number(score?.interpretability ?? 0)
  const bonus          = Math.min(50, Math.max(0, 500 - currentInterp))
  const newSubmissions = (score?.mwp_submissions ?? 0) + 1

  await supabase
    .from('ai_agent_scores')
    .update({
      interpretability: currentInterp + bonus,
      mwp_submissions:  newSubmissions,
      is_transparent:   true,
      last_mwp_hash:    mwpHash,
    })
    .eq('address', address)

  return NextResponse.json({ ok: true, bonus, newSubmissions })
}

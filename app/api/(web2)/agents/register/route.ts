// =============================================================================
// POST /api/agents/register — register an agent wallet in ai_agent_profiles
// Creates profile + score row. Idempotent (upsert).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function POST(req: NextRequest) {
  let body: { address?: string; erc8004TokenId?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const address = body.address?.toLowerCase()
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  // Upsert profile
  const { error: profileErr } = await supabase
    .from('ai_agent_profiles')
    .upsert(
      { address, erc8004_token_id: body.erc8004TokenId ?? null, last_seen_at: new Date().toISOString() },
      { onConflict: 'address' }
    )

  if (profileErr) {
    console.error('[POST /api/agents/register] profile upsert:', profileErr.message)
    return NextResponse.json({ error: 'registration failed' }, { status: 500 })
  }

  // Upsert score row (default zeros)
  const { error: scoreErr } = await supabase
    .from('ai_agent_scores')
    .upsert({ address }, { onConflict: 'address', ignoreDuplicates: true })

  if (scoreErr) {
    console.error('[POST /api/agents/register] score upsert:', scoreErr.message)
    return NextResponse.json({ error: 'score init failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, address })
}

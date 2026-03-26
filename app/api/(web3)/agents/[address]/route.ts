// =============================================================================
// GET /api/agents/[address] — full score breakdown + ERC-8004 metadata
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address: raw } = await params
  const address = raw?.toLowerCase()

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  const [{ data, error }, { data: pnl }, { data: profile }] = await Promise.all([
    supabase.from('ai_agent_leaderboard').select('*').eq('address', address).maybeSingle(),
    supabase.from('ai_agent_pnl').select('*').eq('address', address).maybeSingle(),
    supabase.from('ai_agent_profiles')
      .select('agent_name, agent_description, x402_support, operational_status, services, metadata_url')
      .eq('address', address).maybeSingle(),
  ])

  if (error) {
    console.error('[GET /api/agents/[address]]', error.message)
    return NextResponse.json({ error: 'failed to load agent' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'agent not found' }, { status: 404 })

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mintware.finance'

  return NextResponse.json({
    ...data,
    pnl:               pnl ?? null,
    // ERC-8004 metadata fields
    agent_name:        profile?.agent_name        ?? null,
    agent_description: profile?.agent_description ?? null,
    x402_support:      profile?.x402_support      ?? false,
    operational_status: profile?.operational_status ?? 'active',
    services:          profile?.services           ?? [],
    metadata_url:      profile?.metadata_url       ?? `${base}/api/agents/${address}/erc8004-metadata`,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
  })
}

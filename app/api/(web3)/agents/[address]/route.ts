// GET /api/agents/[address] — full score breakdown + ERC-8004 metadata
// Auth: none

import { NextRequest } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address: raw } = await params
  return createHandler(async (_req, ctx) => {
    const address = raw?.toLowerCase()
    if (!address || !/^0x[0-9a-f]{40}$/.test(address)) return ctx.json({ error: 'invalid address' }, 400)

    const [{ data, error }, { data: pnl }, { data: profile }] = await Promise.all([
      ctx.supabase.from('ai_agent_leaderboard').select('*').eq('address', address).maybeSingle(),
      ctx.supabase.from('ai_agent_pnl').select('*').eq('address', address).maybeSingle(),
      ctx.supabase.from('ai_agent_profiles').select('agent_name, agent_description, x402_support, operational_status, services, metadata_url').eq('address', address).maybeSingle(),
    ])

    if (error) {
      ctx.log.error('agents/[address]', 'failed to load agent', { error: error.message })
      return ctx.json({ error: 'failed to load agent' }, 500)
    }
    if (!data) return ctx.json({ error: 'agent not found' }, 404)

    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mintware.finance'

    const res = ctx.json({
      ...data, pnl: pnl ?? null,
      agent_name:         profile?.agent_name        ?? null,
      agent_description:  profile?.agent_description ?? null,
      x402_support:       profile?.x402_support      ?? false,
      operational_status: profile?.operational_status ?? 'active',
      services:           profile?.services           ?? [],
      metadata_url:       profile?.metadata_url       ?? `${base}/api/agents/${address}/erc8004-metadata`,
    })
    res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
    return res
  })(req)
}

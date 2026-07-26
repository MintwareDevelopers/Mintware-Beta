// GET /api/agents/[address]/erc8004-metadata
// Serves ERC-8004 compliant metadata JSON for an agent.
// Auth: none (public metadata, CORS-enabled)

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

    const [{ data: profile }, { data: score }] = await Promise.all([
      ctx.supabase.from('ai_agent_profiles').select('agent_name, agent_description, x402_support, operational_status, services, erc8004_token_id').eq('address', address).maybeSingle(),
      ctx.supabase.from('ai_agent_leaderboard').select('total_score, rank, is_transparent').eq('address', address).maybeSingle(),
    ])

    if (!profile) return ctx.json({ error: 'agent not found' }, 404)

    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mintware.finance'

    const metadata = {
      name:              profile.agent_name        ?? `Agent ${address.slice(0, 8)}…${address.slice(-4)}`,
      description:       profile.agent_description ?? 'AI agent with on-chain reputation tracked by Mintware Attribution.',
      image:             `${base}/og.png`,
      external_url:      `${base}/agent/${address}`,
      type:              'trustless-agent',
      operationalStatus: profile.operational_status ?? 'active',
      x402Support:       profile.x402_support        ?? false,
      services:          profile.services             ?? [],
      attributes: [
        { trait_type: 'Attribution Score', value: score?.total_score ?? 0 },
        { trait_type: 'Leaderboard Rank',  value: score?.rank        ?? null },
        { trait_type: 'Transparent Agent', value: score?.is_transparent ? 'Yes' : 'No' },
        { trait_type: 'Operational Status', value: profile.operational_status ?? 'active' },
        { trait_type: 'x402 Support',       value: profile.x402_support ? 'Supported' : 'Not supported' },
      ].filter(a => a.value !== null),
      reputation: {
        platform: 'Mintware', score: score?.total_score ?? 0, rank: score?.rank ?? null,
        contract_address: '0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421', chain_id: 8453,
        profile_url: `${base}/agent/${address}`,
      },
    }

    const res = ctx.json(metadata)
    res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
    res.headers.set('Access-Control-Allow-Origin', '*')
    return res
  })(req)
}

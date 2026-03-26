// =============================================================================
// GET /api/agents/[address]/erc8004-metadata
//
// Serves ERC-8004 compliant metadata JSON for an agent.
// This is the URL that should be set as tokenURI when registering with the
// ERC-8004 Identity Registry — NFT explorers and agent discovery tools read it.
//
// Schema follows ERC-8004 spec:
//   https://eips.ethereum.org/EIPS/eip-8004
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

  const [{ data: profile }, { data: score }] = await Promise.all([
    supabase
      .from('ai_agent_profiles')
      .select('agent_name, agent_description, x402_support, operational_status, services, erc8004_token_id')
      .eq('address', address)
      .maybeSingle(),
    supabase
      .from('ai_agent_leaderboard')
      .select('total_score, rank, is_transparent')
      .eq('address', address)
      .maybeSingle(),
  ])

  if (!profile) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 })
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mintware.finance'

  // ERC-8004 compliant metadata
  const metadata = {
    // ── ERC-721 / OpenSea standard fields ─────────────────────────────────
    name:         profile.agent_name        ?? `Agent ${address.slice(0, 8)}…${address.slice(-4)}`,
    description:  profile.agent_description ?? 'AI agent with on-chain reputation tracked by Mintware Attribution.',
    image:        `${base}/og.png`,
    external_url: `${base}/agent/${address}`,

    // ── ERC-8004 specific fields ───────────────────────────────────────────
    type:              'trustless-agent',
    operationalStatus: profile.operational_status ?? 'active',
    x402Support:       profile.x402_support        ?? false,
    services:          profile.services             ?? [],

    // ── Mintware reputation data ───────────────────────────────────────────
    attributes: [
      { trait_type: 'Attribution Score', value: score?.total_score ?? 0 },
      { trait_type: 'Leaderboard Rank',  value: score?.rank        ?? null },
      { trait_type: 'Transparent Agent', value: score?.is_transparent ? 'Yes' : 'No' },
      { trait_type: 'Operational Status', value: profile.operational_status ?? 'active' },
      { trait_type: 'x402 Support',       value: profile.x402_support ? 'Supported' : 'Not supported' },
    ].filter(a => a.value !== null),

    // ── Discovery / registry links ─────────────────────────────────────────
    reputation: {
      platform:         'Mintware',
      score:            score?.total_score ?? 0,
      rank:             score?.rank        ?? null,
      contract_address: '0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421',
      chain_id:         8453,
      profile_url:      `${base}/agent/${address}`,
    },
  }

  return NextResponse.json(metadata, {
    headers: {
      'Cache-Control':                'public, s-maxage=60, stale-while-revalidate=300',
      'Access-Control-Allow-Origin':  '*',
    },
  })
}

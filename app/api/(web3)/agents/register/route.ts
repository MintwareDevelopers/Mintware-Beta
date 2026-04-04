// =============================================================================
// POST /api/agents/register — upsert agent into ai_agent_profiles + ai_agent_scores
// Idempotent. Optional erc8004TokenId links the wallet to an ERC-8004 token.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { recoverMessageAddress } from 'viem'
import { buildAgentRegisterMessage } from '@/lib/web3/signedActionMessages'

interface RegisterBody {
  address?:          string
  erc8004TokenId?:   number
  // ERC-8004 metadata fields (all optional)
  agentName?:        string
  agentDescription?: string
  x402Support?:      boolean
  operationalStatus?: 'active' | 'paused' | 'offline'
  services?:         { name: string; endpoint: string; version?: string }[]
  name?:             string | null
  authMessage?:      string
  authSignature?:    `0x${string}`
  issuedAt?:         number
}

const VALID_STATUSES = new Set(['active', 'paused', 'offline'])
const MAX_AUTH_AGE_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  let body: RegisterBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const address = body.address?.toLowerCase()
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }

  if (body.operationalStatus && !VALID_STATUSES.has(body.operationalStatus)) {
    return NextResponse.json({ error: 'invalid operationalStatus' }, { status: 400 })
  }

  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number') {
    return NextResponse.json({ error: 'signed authorization is required' }, { status: 401 })
  }

  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS) {
    return NextResponse.json({ error: 'authorization expired' }, { status: 401 })
  }

  const agentName = body.agentName ?? body.name ?? undefined
  const expectedMessage = buildAgentRegisterMessage({
    address,
    issuedAt: body.issuedAt,
    erc8004TokenId: body.erc8004TokenId,
    agentName,
    agentDescription: body.agentDescription,
    x402Support: body.x402Support,
    operationalStatus: body.operationalStatus,
    services: body.services,
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
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mintware.finance'

  const profilePayload: Record<string, unknown> = {
    address,
    erc8004_token_id:  body.erc8004TokenId   ?? null,
    last_seen_at:      new Date().toISOString(),
    metadata_url:      `${base}/api/agents/${address}/erc8004-metadata`,
  }
  if (agentName             !== undefined) profilePayload.agent_name         = agentName.slice(0, 80)
  if (body.agentDescription !== undefined) profilePayload.agent_description  = body.agentDescription.slice(0, 500)
  if (body.x402Support      !== undefined) profilePayload.x402_support       = body.x402Support
  if (body.operationalStatus !== undefined) profilePayload.operational_status = body.operationalStatus
  if (body.services         !== undefined) profilePayload.services           = body.services.slice(0, 20)

  const { error: profileErr } = await supabase
    .from('ai_agent_profiles')
    .upsert(profilePayload, { onConflict: 'address' })
  if (profileErr) {
    console.error('[POST /api/agents/register] profile:', profileErr.message)
    return NextResponse.json({ error: 'registration failed' }, { status: 500 })
  }

  const { error: scoreErr } = await supabase
    .from('ai_agent_scores')
    .upsert({ address }, { onConflict: 'address', ignoreDuplicates: true })
  if (scoreErr) {
    console.error('[POST /api/agents/register] score:', scoreErr.message)
    return NextResponse.json({ error: 'score init failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok:           true,
    address,
    metadata_url: `${base}/api/agents/${address}/erc8004-metadata`,
  })
}

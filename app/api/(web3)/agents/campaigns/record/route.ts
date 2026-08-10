// POST /api/agents/campaigns/record — oracle signs a verified agent action
// Auth: Bearer AI_ATTRIBUTION_ORACLE_SECRET

import { createHandler } from '@/lib/web2/routeHandler'
import { AI_ATTRIBUTION_ORACLE_SECRET } from '@/lib/constants'
import { createPublicClient, http, type Hex } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { getOracleSigner } from '@/lib/web3/oracleSigner'

const CHAIN_ID = Number(process.env.AI_ATTRIBUTION_CHAIN_ID ?? 84532)
const CHAIN    = CHAIN_ID === 8453 ? base : baseSepolia

const CONTRACT_ADDRESS = (
  CHAIN_ID === 8453
    ? (process.env.NEXT_PUBLIC_AI_ATTRIBUTION_CONTRACT_BASE ?? '0x0000000000000000000000000000000000000000')
    : (process.env.NEXT_PUBLIC_AI_ATTRIBUTION_CONTRACT_BASE_SEPOLIA ?? '0x0000000000000000000000000000000000000000')
) as Hex

const ACTION_TYPES = {
  RecordAction: [
    { name: 'agent',             type: 'address' },
    { name: 'volumeContributed', type: 'uint256' },
    { name: 'mwpContextHash',    type: 'bytes32' },
    { name: 'campaignId',        type: 'uint256' },
    { name: 'nonce',             type: 'uint256' },
    { name: 'deadline',          type: 'uint256' },
  ],
} as const

const NONCES_ABI = [{ name: 'nonces', type: 'function', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const

export const POST = createHandler(async (req, ctx) => {
  // Agent role (audit C2) — separable from the range key via AGENT_ORACLE_PRIVATE_KEY.
  let agentAccount
  try {
    agentAccount = await getOracleSigner('agent')
  } catch {
    return ctx.json({ error: 'oracle key not configured' }, 500)
  }

  let body: { address?: string; volumeWei?: string; mwpHash?: string; campaignId?: number }
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'invalid json' }, 400) }

  const address    = body.address?.toLowerCase()
  const volumeWei  = BigInt(body.volumeWei ?? '0')
  const mwpHash    = body.mwpHash?.toLowerCase() ?? null
  const campaignId = body.campaignId ?? 0

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) return ctx.json({ error: 'invalid address' }, 400)

  const { data: profile } = await ctx.supabase.from('ai_agent_profiles').select('address').eq('address', address).maybeSingle()
  if (!profile) return ctx.json({ error: 'agent not registered' }, 404)

  // H4: nonce → sign → DB (never touch DB if signing fails)
  const publicClient = createPublicClient({ chain: CHAIN, transport: http() })
  const nonce = await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: NONCES_ABI, functionName: 'nonces', args: [address as Hex] }) as bigint

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const account  = agentAccount

  const signature = await account.signTypedData({
    domain: { name: 'AIAttribution', version: '2', chainId: CHAIN_ID, verifyingContract: CONTRACT_ADDRESS },
    types: ACTION_TYPES, primaryType: 'RecordAction',
    message: { agent: address as Hex, volumeContributed: volumeWei, mwpContextHash: (mwpHash ?? `0x${'00'.repeat(32)}`) as Hex, campaignId: BigInt(campaignId), nonce, deadline },
  })

  const behaviorDelta = Number(volumeWei / BigInt(1e18))
  const { data: score } = await ctx.supabase.from('ai_agent_scores').select('behavior, interpretability, mwp_submissions').eq('address', address).maybeSingle()

  const updates: Record<string, unknown> = { behavior: (Number(score?.behavior ?? 0) + behaviorDelta) }

  if (mwpHash && /^0x[0-9a-f]{64}$/.test(mwpHash)) {
    const { data: existing } = await ctx.supabase.from('ai_agent_mwp_hashes').select('id').eq('address', address).eq('mwp_hash', mwpHash).maybeSingle()
    if (!existing) {
      const current = Number(score?.interpretability ?? 0)
      updates.interpretability = current + Math.min(50, Math.max(0, 500 - current))
      updates.mwp_submissions  = (score?.mwp_submissions ?? 0) + 1
      updates.is_transparent   = true
      updates.last_mwp_hash    = mwpHash
      await ctx.supabase.from('ai_agent_mwp_hashes').insert({ address, mwp_hash: mwpHash })
    }
  }

  await ctx.supabase.from('ai_agent_scores').update(updates).eq('address', address)

  if (campaignId > 0) {
    const { data: cv } = await ctx.supabase.from('ai_campaign_volume').select('volume_wei').eq('campaign_id', campaignId).eq('address', address).maybeSingle()
    if (cv) {
      await ctx.supabase.from('ai_campaign_volume').update({ volume_wei: (BigInt(cv.volume_wei ?? '0') + volumeWei).toString() }).eq('campaign_id', campaignId).eq('address', address)
    } else {
      await ctx.supabase.from('ai_campaign_volume').insert({ campaign_id: campaignId, address, volume_wei: volumeWei.toString() })
    }
  }

  return ctx.json({ ok: true, signature, nonce: nonce.toString(), deadline: deadline.toString(), address, behaviorDelta, campaignId })
}, { auth: 'bearer-token', bearerSecret: AI_ATTRIBUTION_ORACLE_SECRET })

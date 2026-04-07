// POST /api/campaigns/sol-swap-event
// Solana swap event handler — credits campaign points for Jupiter/Raydium/Orca swaps.
// Auth: none (on-chain tx verification via verifySolanaTx)

import { createHandler } from '@/lib/web2/routeHandler'
import { processSwapEvent } from '@/lib/rewards/swapHook'
import { verifySolanaTx }   from '@/lib/web3/verifySolanaTx'
import type { SwapEvent }   from '@/lib/rewards/types'

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

interface SolSwapEventPayload {
  tx_signature: string
  wallet:       string
  campaign_id?: string
  token_in:     string
  token_out:    string
  amount_usd:   number
  timestamp?:   string
}

function validatePayload(body: unknown): body is SolSwapEventPayload {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.tx_signature === 'string'  && b.tx_signature.length >= 80 &&
    typeof b.wallet       === 'string'  && SOLANA_RE.test(b.wallet) &&
    (b.campaign_id === undefined || (typeof b.campaign_id === 'string' && b.campaign_id.length > 0)) &&
    typeof b.token_in     === 'string'  && b.token_in.length  > 0 &&
    typeof b.token_out    === 'string'  && b.token_out.length > 0 &&
    typeof b.amount_usd   === 'number'  && b.amount_usd > 0
  )
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'invalid json' }, 400) }

  if (!validatePayload(body)) {
    return ctx.json({
      error: 'invalid payload',
      required: ['tx_signature', 'wallet', 'token_in', 'token_out', 'amount_usd'],
      optional: ['campaign_id', 'timestamp'],
    }, 422)
  }

  const rpcUrl = process.env.SOLANA_RPC_URL
  const verification = await verifySolanaTx(body.tx_signature, body.wallet, rpcUrl)

  if (!verification.valid) {
    return ctx.json({ credited: false, skip_reason: verification.error ?? 'tx_invalid', rpc_error: verification.rpcError })
  }

  const txKey    = body.tx_signature
  const wallet   = body.wallet
  const timestamp = body.timestamp ?? new Date().toISOString()

  // Route A: campaign_id provided
  if (body.campaign_id) {
    const event: SwapEvent = { tx_hash: txKey, wallet, campaign_id: body.campaign_id, token_in: body.token_in, token_out: body.token_out, amount_usd: body.amount_usd, timestamp }
    const result = await processSwapEvent(event)
    return ctx.json(result)
  }

  // Route B: resolve all live campaigns the wallet is in
  const { data, error } = await ctx.supabase
    .from('participants')
    .select('campaign_id, campaigns!inner(status)')
    .eq('wallet', wallet)

  if (error) {
    ctx.log.error('sol-swap-event', 'participants lookup failed', { error: error.message })
    return ctx.json({ error: 'internal error' }, 500)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const participationRows = (data ?? []).filter((row: any) => {
    const c = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns
    return c?.status === 'live'
  }).map((row: { campaign_id: string }) => ({ campaign_id: row.campaign_id }))

  if (participationRows.length === 0) {
    return ctx.json({ credited: false, skip_reason: 'wallet_not_participant' })
  }

  const results = []
  for (const { campaign_id } of participationRows) {
    const event: SwapEvent = { tx_hash: txKey, wallet, campaign_id, token_in: body.token_in, token_out: body.token_out, amount_usd: body.amount_usd, timestamp }
    try {
      results.push({ campaign_id, ...await processSwapEvent(event) })
    } catch {
      results.push({ campaign_id, credited: false, skip_reason: 'db_error' as const })
    }
  }

  return ctx.json({ credited: results.some((r) => r.credited), results })
})

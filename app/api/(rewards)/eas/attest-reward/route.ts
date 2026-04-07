// =============================================================================
// POST /api/eas/attest-reward
//
// Signs a CampaignReward offchain EAS attestation.
// Called by the on-chain event indexer after a Claimed event is indexed and
// confirmed on-chain.
//
// Authentication: Bearer token from SWAP_WEBHOOK_SECRET (reused from
// swap-event/route.ts — same indexer, same secret).
//
// Body: {
//   wallet:          string   — claimant address (0x...)
//   campaign_id:     string
//   epoch_number:    number
//   amount_wei:      string   — BigInt as decimal string
//   token_contract:  string   — ERC-20 address (0x...)
//   claim_tx_hash:   string   — tx hash (0x...)
// }
//
// Returns: { uid: string }
// =============================================================================

import { attestReward } from '@/lib/rewards/eas'
import { createHandler } from '@/lib/web2/routeHandler'

function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

function isValidTxHash(raw: string): boolean {
  return /^0x[0-9a-f]{64}$/i.test(raw)
}

export const POST = createHandler(async (req, ctx) => {
  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return ctx.json({ error: 'invalid json' }, 400)
  }

  const b = body as Record<string, unknown>

  const wallet         = typeof b.wallet         === 'string' ? b.wallet         : null
  const campaign_id    = typeof b.campaign_id    === 'string' ? b.campaign_id    : null
  const epoch_number   = typeof b.epoch_number   === 'number' ? b.epoch_number   : null
  const amount_wei     = typeof b.amount_wei     === 'string' ? b.amount_wei     : null
  const token_contract = typeof b.token_contract === 'string' ? b.token_contract : null
  const claim_tx_hash  = typeof b.claim_tx_hash  === 'string' ? b.claim_tx_hash  : null

  if (!wallet || !isValidAddress(wallet)) {
    return ctx.json({ error: 'invalid wallet' }, 400)
  }
  if (!campaign_id) {
    return ctx.json({ error: 'campaign_id required' }, 400)
  }
  if (epoch_number === null || typeof epoch_number !== 'number') {
    return ctx.json({ error: 'epoch_number required' }, 400)
  }
  if (!amount_wei) {
    return ctx.json({ error: 'amount_wei required' }, 400)
  }
  if (!token_contract || !isValidAddress(token_contract)) {
    return ctx.json({ error: 'invalid token_contract' }, 400)
  }
  if (!claim_tx_hash || !isValidTxHash(claim_tx_hash)) {
    return ctx.json({ error: 'invalid claim_tx_hash' }, 400)
  }

  // ── Attest ────────────────────────────────────────────────────────────────
  let uid: string
  try {
    uid = await attestReward(wallet.toLowerCase(), {
      campaignId:    campaign_id,
      epochNumber:   epoch_number,
      amountClaimed: BigInt(amount_wei),
      tokenContract: token_contract,
      claimTxHash:   claim_tx_hash,
    })
  } catch (err) {
    ctx.log.error('attest-reward', 'attestReward error', { err: String(err) })
    return ctx.json({ error: 'attestation failed' }, 500)
  }

  // ── Upsert eas_attestations ────────────────────────────────────────────────
  const { error: attErr } = await ctx.supabase
    .from('eas_attestations')
    .upsert(
      {
        wallet:      wallet.toLowerCase(),
        schema_name: 'CampaignReward',
        eas_uid:     uid,
        attested_at: new Date().toISOString(),
        metadata:    { campaign_id, epoch_number },
      },
      { onConflict: 'eas_uid' }
    )

  if (attErr) {
    ctx.log.warn('attest-reward', 'eas_attestations upsert error (non-critical)', { error: attErr.message })
    // Non-critical — UID is still returned
  }

  // ── Link to daily_payouts ──────────────────────────────────────────────────
  const { error: payoutErr } = await ctx.supabase
    .from('daily_payouts')
    .update({ eas_uid: uid })
    .eq('campaign_id',  campaign_id)
    .eq('epoch_number', epoch_number)
    .eq('wallet',       wallet.toLowerCase())

  if (payoutErr) {
    ctx.log.warn('attest-reward', 'daily_payouts update error (non-critical)', { error: payoutErr.message })
    // Non-critical
  }

  return ctx.json({ uid })
}, { auth: 'bearer-token', bearerSecret: process.env.SWAP_WEBHOOK_SECRET ?? '' })

export const GET = createHandler(async (_req, ctx) => {
  return ctx.json({ error: 'method not allowed' }, 405)
})

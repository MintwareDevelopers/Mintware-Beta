// =============================================================================
// POST /api/campaigns/join
//
// Phase 6 update: accepts Solana (base58) wallets in addition to EVM (0x).
// Uses getCombinedAttributionScore() so a linked wallet pair gets credit for
// the stronger score at join time.
// =============================================================================

import { solanaEnabled } from '@/lib/web3/featureFlags'
import { getCombinedAttributionScore }   from '@/lib/rewards/combinedScore'
import { createHandler } from '@/lib/web2/routeHandler'

const EVM_RE    = /^0x[0-9a-fA-F]{40}$/
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function isValidAddress(addr: string): boolean {
  return EVM_RE.test(addr) || (solanaEnabled && SOLANA_RE.test(addr))
}

/** Preserve case for Solana; lowercase EVM */
function normalizeWallet(addr: string): string {
  return EVM_RE.test(addr) ? addr.toLowerCase() : addr
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.json() } catch {
    return ctx.json({ error: 'invalid json' }, 400)
  }

  const { campaign_id, address } = (body ?? {}) as Record<string, unknown>

  if (typeof campaign_id !== 'string' || !campaign_id) {
    return ctx.json({ error: 'campaign_id required' }, 422)
  }
  if (typeof address !== 'string' || !isValidAddress(address)) {
    return ctx.json(
      { error: 'invalid wallet address — must be EVM (0x...)' },
      422
    )
  }

  const wallet = normalizeWallet(address)

  // 1. Load campaign
  const { data: campaign, error: campaignErr } = await ctx.supabase
    .from('campaigns')
    .select('id, status, min_score, campaign_type')
    .eq('id', campaign_id)
    .single()

  if (campaignErr) {
    ctx.log.error('campaigns/join', 'Campaign query error', { error: campaignErr })
    return ctx.json({ error: `campaign lookup failed: ${campaignErr.message}` }, 500)
  }
  if (!campaign) {
    return ctx.json({ error: 'campaign not found' }, 404)
  }
  if (campaign.status !== 'live' && campaign.status !== 'upcoming') {
    return ctx.json({ error: 'campaign is not accepting participants' }, 409)
  }

  // 2. Fetch combined Attribution score (EVM + linked Solana, or Solana + linked EVM)
  //    Falls back gracefully to 0 on any error — never blocks a join.
  let attribution_score = 0
  try {
    attribution_score = await getCombinedAttributionScore(wallet, ctx.supabase)
  } catch (e) {
    ctx.log.warn('campaigns/join', 'Score fetch failed, defaulting to 0', { error: e instanceof Error ? e.message : String(e) })
  }

  // 3. min_score gate (points campaigns only — token_pool is open access)
  const minScore = Number(campaign.min_score ?? 0)
  if (campaign.campaign_type === 'points' && minScore > 0 && attribution_score < minScore) {
    return ctx.json(
      { error: `Score too low. Required: ${minScore}, yours: ${attribution_score}` },
      403
    )
  }

  // 4. Upsert participant
  const { error: upsertErr } = await ctx.supabase
    .from('participants')
    .upsert(
      {
        campaign_id,
        wallet,
        attribution_score,
        sharing_score:    0,
        total_points:     0,
        total_earned_usd: 0,
        joined_at:        new Date().toISOString(),
      },
      { onConflict: 'campaign_id,wallet', ignoreDuplicates: true }
    )

  if (upsertErr) {
    ctx.log.error('campaigns/join', 'Upsert error', { error: upsertErr })
    return ctx.json({ error: `join failed: ${upsertErr.message}` }, 500)
  }

  return ctx.json({ ok: true, campaign_id, wallet, attribution_score })
}, { rateLimit: { max: 15, windowMs: 60_000 } })

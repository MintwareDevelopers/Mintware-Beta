// POST /api/campaigns/refresh-score
// Updates attribution_score in participants for all live campaigns a wallet is in.
// Auth: none (wallet provided in body)

import { createHandler } from '@/lib/web2/routeHandler'
import { solanaEnabled } from '@/lib/web3/featureFlags'
import { getCombinedAttributionScore } from '@/lib/rewards/combinedScore'

const EVM_RE    = /^0x[0-9a-fA-F]{40}$/
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'invalid json' }, 400) }

  const { wallet: rawWallet } = (body ?? {}) as Record<string, unknown>
  if (typeof rawWallet !== 'string') return ctx.json({ error: 'wallet required' }, 422)

  const isEvm    = EVM_RE.test(rawWallet)
  const isSolana = solanaEnabled && !isEvm && SOLANA_RE.test(rawWallet)
  if (!isEvm && !isSolana) return ctx.json({ error: 'invalid wallet address' }, 422)

  const wallet = isEvm ? rawWallet.toLowerCase() : rawWallet

  let newScore: number
  try {
    newScore = await getCombinedAttributionScore(wallet, ctx.supabase)
  } catch (err) {
    ctx.log.error('refresh-score', 'getCombinedAttributionScore error', { error: String(err) })
    return ctx.json({ error: 'score fetch failed' }, 500)
  }

  if (newScore === 0) return ctx.json({ updated: 0, score: 0 })

  const { data: updatedRows, error: updateErr } = await ctx.supabase
    .from('participants')
    .update({ attribution_score: newScore })
    .eq('wallet', wallet)
    .select('campaign_id')

  if (updateErr) {
    ctx.log.error('refresh-score', 'participants update error', { error: updateErr.message })
    return ctx.json({ error: 'update failed' }, 500)
  }

  const updated = updatedRows?.length ?? 0
  ctx.log.info('refresh-score', 'Score refreshed', { wallet, newScore, rows_updated: updated })
  return ctx.json({ updated, score: newScore })
}, { rateLimit: { max: 10, windowMs: 60_000 } }) // throttle external-worker score recompute

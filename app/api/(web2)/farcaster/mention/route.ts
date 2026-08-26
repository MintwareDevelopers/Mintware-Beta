// POST /api/farcaster/mention — Neynar webhook: fires on cast.created when @mintware-agent
// (FID 3347814) is mentioned. Templated score-lookup reply — NO LLM call on this path; the
// score is a data lookup + format, not something that needs judgment. See
// docs/product/farcaster-attribution-growth-playbook.md for the account's operating rules
// (disclosed, utility-first, no hype).

import { createHandler } from '@/lib/web2/routeHandler'
import { verifyNeynarSignature, resolveTargetAddress, formatScoreReply, replyToCast } from '@/lib/web2/farcaster'
import { getServerLegacyScore } from '@/lib/attribution/serverScore'

export const dynamic = 'force-dynamic'

export const POST = createHandler(async (req, ctx) => {
  // Signature verification needs the RAW body — read as text before any JSON.parse.
  const rawBody = await req.text()
  const signature = req.headers.get('X-Neynar-Signature')
  if (!verifyNeynarSignature(rawBody, signature)) {
    ctx.log.warn('farcaster', 'mention webhook: bad or missing signature')
    return ctx.json({ error: 'invalid_signature' }, 401)
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return ctx.json({ error: 'invalid_json' }, 400)
  }

  if (payload?.type !== 'cast.created') {
    // Webhook is scoped to cast.created via the subscription filter, but don't assume —
    // ack and no-op on anything else rather than error.
    return ctx.json({ ok: true, skipped: 'not_cast_created' })
  }

  const cast = payload.data
  const castHash: string | undefined = cast?.hash
  const castText: string = cast?.text ?? ''
  const authorEthAddresses: string[] | undefined = cast?.author?.verified_addresses?.eth_addresses

  if (!castHash) return ctx.json({ error: 'missing_cast_hash' }, 400)

  const address = resolveTargetAddress(castText, authorEthAddresses)
  if (!address) {
    // No address in the cast and no verified wallet to fall back to — reply asking for one,
    // rather than silently no-op'ing (the mention was real, deserves a real response).
    await replyToCast(castHash, "Didn't find an address to score — reply with a wallet address, or verify one on your Farcaster account and just say \"score me.\"")
      .catch((e) => ctx.log.warn('farcaster', 'reply failed (no-address case)', { err: String(e) }))
    return ctx.json({ ok: true, skipped: 'no_address_found' })
  }

  const score = await getServerLegacyScore(address, { supabase: ctx.supabase })
  const text = formatScoreReply(address, score)

  await replyToCast(castHash, text)
  ctx.log.info('farcaster', 'replied to mention', { castHash, address })

  return ctx.json({ ok: true, address, score: score.score })
})

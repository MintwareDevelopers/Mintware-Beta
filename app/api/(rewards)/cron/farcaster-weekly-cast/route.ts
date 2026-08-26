// GET /api/cron/farcaster-weekly-cast — drafts the weekly @mintware-agent leaderboard cast.
//
// DRAFT-ONLY. This route never posts to Farcaster — it returns the draft text for review.
// Posting is a deliberate, separate, human-reviewed action (see
// docs/product/farcaster-attribution-growth-playbook.md — credibility-primary, no unreviewed
// autonomous posting yet). Safe to put on a weekly Vercel cron schedule once wired in
// vercel.json — drafting has zero public-facing effect either way.
//
// Optional ?addresses=0x..,0x.. — comma-separated list to score. Defaults to the team
// treasury wallet alone; a real weekly list (trending/active wallets) is a real follow-up,
// not built here — see the response's `note` field.

import { createHandler } from '@/lib/web2/routeHandler'
import { getServerLegacyScore } from '@/lib/attribution/serverScore'
import { generateWeeklyDigest, type ScoredEntry } from '@/lib/web2/farcasterDigest'

export const dynamic = 'force-dynamic'

const EVM_RE = /^0x[0-9a-fA-F]{40}$/

// Fallback default when no ?addresses= is given. NOT TREASURY_ADDRESS — checked before launch
// (2026-08-26) and every Mintware-controlled candidate wallet scores 0/925 (stale testnet
// contract or genuinely fresh EOA), which would make every un-parameterized run useless. Using
// vitalik.eth as a known-good placeholder until the real candidate-address pipeline (trending/
// active wallets) exists — see the route's own `note` field below.
const FALLBACK_SEED_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

export const GET = createHandler(async (req, ctx) => {
  const url = new URL(req.url)
  const raw = url.searchParams.get('addresses')
  const addresses = raw
    ? raw.split(',').map((a) => a.trim()).filter((a) => EVM_RE.test(a))
    : [FALLBACK_SEED_ADDRESS]

  if (addresses.length === 0) {
    return ctx.json({ error: 'no_valid_addresses' }, 400)
  }

  const entries: ScoredEntry[] = []
  for (const address of addresses) {
    const score = await getServerLegacyScore(address, { supabase: ctx.supabase })
    entries.push({ address, score })
  }

  const draft = generateWeeklyDigest(entries)
  ctx.log.info('farcaster', 'weekly digest drafted (not posted)', { addresses, draftLength: draft.length })

  return ctx.json({
    draft,
    scoredAddresses: addresses,
    note: 'DRAFT ONLY — not posted. Default seed is a known-good placeholder (Mintware\'s own wallets all score 0 — see FALLBACK_SEED_ADDRESS comment); a real weekly candidate list (trending/active wallets) is a follow-up, not built here. To post: review this text, then call publishCast() from lib/web2/farcaster.ts (same helper the launch-cast script uses).',
  })
}, { auth: 'bearer-token' })

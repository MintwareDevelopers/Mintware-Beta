// =============================================================================
// GET /api/teams/whitelist?wallet=
//
// Returns whether the wallet is in whitelisted_teams with status='approved'.
// Used by the create-campaign flow to gate points campaigns.
//
// Response:
//   200 { whitelisted: boolean }
//   400 { error: string }
//
// Auth: none — wallet address is the filter. Uses service role to bypass RLS.
// =============================================================================

import { createHandler } from '@/lib/web2/routeHandler'

function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

export const GET = createHandler(async (req, ctx) => {
  const raw = req.nextUrl.searchParams.get('wallet')

  if (!raw) {
    return ctx.json({ error: 'wallet param is required' }, 400)
  }
  if (!isValidAddress(raw)) {
    return ctx.json(
      { error: 'invalid wallet — must be 0x followed by 40 hex characters' },
      400
    )
  }

  const wallet = raw.toLowerCase()

  const { data, error } = await ctx.supabase
    .from('whitelisted_teams')
    .select('wallet')
    .eq('wallet', wallet)
    .eq('status', 'approved')
    .maybeSingle()

  if (error) {
    ctx.log.error('teams/whitelist', 'Query error', { error })
    return ctx.json({ error: 'Failed to check whitelist' }, 500)
  }

  return ctx.json({ whitelisted: data !== null })
})

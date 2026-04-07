// GET /api/campaigns/mine?wallet=
// Returns all campaigns where campaigns.creator = wallet.
// Auth: none

import { createHandler } from '@/lib/web2/routeHandler'

function isValidAddress(raw: string) { return /^0x[0-9a-f]{40}$/i.test(raw) }

export const GET = createHandler(async (req, ctx) => {
  const raw = req.nextUrl.searchParams.get('wallet')
  if (!raw) return ctx.json({ error: 'wallet param is required' }, 400)
  if (!isValidAddress(raw)) return ctx.json({ error: 'invalid wallet — must be 0x followed by 40 hex characters' }, 400)

  const { data, error } = await ctx.supabase
    .from('campaigns')
    .select('*')
    .eq('creator', raw.toLowerCase())
    .order('created_at', { ascending: false })

  if (error) {
    if (error.code === '42703') return ctx.json({ campaigns: [] })
    ctx.log.error('campaigns/mine', 'query error', { error: error.message })
    return ctx.json({ error: 'Failed to fetch campaigns' }, 500)
  }

  return ctx.json({ campaigns: data ?? [] })
})

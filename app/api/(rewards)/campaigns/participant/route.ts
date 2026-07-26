// GET /api/campaigns/participant?campaign_id=&address=
// Checks whether a wallet has joined a campaign.
// Auth: none

import { createHandler } from '@/lib/web2/routeHandler'

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i

export const GET = createHandler(async (req, ctx) => {
  const { searchParams } = req.nextUrl
  const campaignId = searchParams.get('campaign_id')
  const rawAddress = searchParams.get('address')

  if (!campaignId || !rawAddress) return ctx.json({ error: 'campaign_id and address are required' }, 400)
  if (!ETH_ADDRESS_RE.test(rawAddress)) return ctx.json({ error: 'invalid wallet address' }, 400)

  const wallet = rawAddress.toLowerCase()

  const { data, error } = await ctx.supabase
    .from('participants')
    .select('wallet, campaign_id, attribution_score, total_points, joined_at')
    .eq('campaign_id', campaignId)
    .eq('wallet', wallet)
    .maybeSingle()

  if (error) {
    ctx.log.error('campaigns/participant', 'Supabase error', { error: error.message })
    return ctx.json({ error: 'Failed to check participant status' }, 500)
  }

  if (!data) return ctx.json({ joined: false, wallet, campaign_id: campaignId })

  return ctx.json({
    joined:            true,
    wallet:            data.wallet,
    campaign_id:       data.campaign_id,
    attribution_score: data.attribution_score,
    total_points:      data.total_points,
    joined_at:         data.joined_at,
  })
})

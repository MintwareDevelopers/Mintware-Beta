import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'

export const dynamic = 'force-dynamic'

// Self-serve: anyone can request a pool be added to the gateway. Lands as a pending row for a curator
// to approve (a human decision, not a TVL gate). One open request per pool/chain (DB unique guard).
export const POST = createHandler(async (req, ctx) => {
  const b = (await req.json().catch(() => ({}))) as {
    poolAddress?: string
    chainId?: number
    pairLabel?: string
    quoteAsset?: string
    requesterWallet?: string
  }
  const poolAddress = b.poolAddress?.toLowerCase()
  const chainId = Number(b.chainId ?? 0)
  if (!poolAddress || !chainId) return ctx.json({ success: false, error: 'pool_and_chain_required' }, 400)
  if (b.quoteAsset && !isAddress(b.quoteAsset)) return ctx.json({ success: false, error: 'bad_quote_asset' }, 400)

  const { error } = await ctx.supabase.from('gateway_pool_requests').insert({
    pool_address: poolAddress,
    chain_id: chainId,
    pair_label: b.pairLabel ?? null,
    quote_asset: b.quoteAsset?.toLowerCase() ?? null,
    requester_wallet: b.requesterWallet?.toLowerCase() ?? null,
  })
  if (error) {
    if (String(error.code) === '23505' || String(error.message).toLowerCase().includes('duplicate')) {
      return ctx.json({ success: false, error: 'already_pending' }, 409)
    }
    ctx.log.warn('gateway.request', 'insert failed', { error: error.message })
    return ctx.json({ success: false, error: 'request_failed' }, 500)
  }
  return ctx.json({ success: true })
}, { rateLimit: { max: 5, windowMs: 60_000 } })

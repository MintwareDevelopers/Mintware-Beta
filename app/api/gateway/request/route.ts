import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayConfig } from '@/lib/gateway/chain'

export const dynamic = 'force-dynamic'

// A v4 pool is identified by its 32-byte poolId (no address); a v3-style pool by a 20-byte address.
// Anything else is queue pollution (HO-10) — reject at the edge.
const POOL_ID_RE = /^0x([0-9a-f]{40}|[0-9a-f]{64})$/
const LABEL_MAX = 64

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
  const poolAddress = String(b.poolAddress ?? '').trim().toLowerCase()
  const chainId = Number(b.chainId ?? 0)
  if (!poolAddress || !chainId) return ctx.json({ success: false, error: 'pool_and_chain_required' }, 400)
  if (!POOL_ID_RE.test(poolAddress)) return ctx.json({ success: false, error: 'bad_pool_id' }, 400)
  const cfg = gatewayConfig()
  if (cfg && chainId !== cfg.chainId) return ctx.json({ success: false, error: 'unsupported_chain' }, 400)
  if (b.quoteAsset && !isAddress(b.quoteAsset, { strict: false })) return ctx.json({ success: false, error: 'bad_quote_asset' }, 400)
  if (b.requesterWallet && !isAddress(b.requesterWallet, { strict: false })) return ctx.json({ success: false, error: 'bad_requester' }, 400)
  const pairLabel = b.pairLabel ? String(b.pairLabel).replace(/[^\x20-\x7e]/g, '').slice(0, LABEL_MAX) : null

  const { error } = await ctx.supabase.from('gateway_pool_requests').insert({
    pool_address: poolAddress,
    chain_id: chainId,
    pair_label: pairLabel,
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

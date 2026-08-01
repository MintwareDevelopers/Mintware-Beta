// POST /api/swap/best-route
// Meta-router: given a LI.FI quote (from the client), decide whether a Mintware V4
// pool beats it for this pair. Registry (Supabase) + V4 Quoter (RPC) live here,
// server-side; the client runs LI.FI directly and calls this to augment it.
//
// Inert by default: returns the LI.FI winner unless NEXT_PUBLIC_MW_ROUTER_ENABLED
// is set AND the chain has a deployed router/quoter AND a pool is listed. See
// docs/developers/phase3-router-design.md. Auth: none. Reads Supabase → dynamic.

import { createPublicClient, http } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { resolveSwapRoute } from '@/lib/web2/router'
import { isRouterEnabled, onchainRouterConfig } from '@/lib/web2/router/config'
import { registryFromFetcher, type RouterPoolRow } from '@/lib/web2/router/listing'
import { createQuoterReader, viemQuoteSimulate, deriveBuyTokenPriceUsd } from '@/lib/web2/router/quoterReader'

export const dynamic = 'force-dynamic'

interface Body {
  chainId: number
  tokenIn: string
  tokenOut: string
  amountIn: string        // base units (decimal string)
  buyTokenDecimals: number
  lifiBuyAmount: string   // base units, net of LI.FI fee
  lifiGasCostUsd: number | null
  fromAmountUsd: number | null
}

function valid(b: unknown): b is Body {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.chainId === 'number' &&
    typeof p.tokenIn === 'string' && p.tokenIn.length > 0 &&
    typeof p.tokenOut === 'string' && p.tokenOut.length > 0 &&
    typeof p.amountIn === 'string' && p.amountIn.length > 0 &&
    typeof p.buyTokenDecimals === 'number' &&
    typeof p.lifiBuyAmount === 'string' && p.lifiBuyAmount.length > 0
  )
}

/** Safe fallback: keep LI.FI, no internal route. */
function lifiOnly(reason: string) {
  return { winner: 'lifi' as const, reason, pool: null, best: null, alternative: null }
}

export const POST = createHandler(
  async (req, ctx) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return ctx.json(lifiOnly('lifi-router-disabled'))
    }
    if (!valid(body)) return ctx.json(lifiOnly('lifi-router-disabled'))

    // Kill switch — the router does nothing.
    if (!isRouterEnabled()) return ctx.json(lifiOnly('lifi-router-disabled'))

    // Chain must have a deployed router + quoter, else no internal route exists.
    const cfg = onchainRouterConfig(body.chainId)
    if (!cfg) return ctx.json(lifiOnly('lifi-only-unlisted'))

    let amountIn: bigint
    let lifiBuyAmount: bigint
    try {
      amountIn = BigInt(body.amountIn)
      lifiBuyAmount = BigInt(body.lifiBuyAmount)
    } catch {
      return ctx.json(lifiOnly('lifi-router-disabled'))
    }

    const registry = registryFromFetcher(async chainId => {
      const { data, error } = await ctx.supabase
        .from('router_pools')
        .select('*')
        .eq('chain_id', chainId)
        .eq('active', true)
      if (error || !data) return []
      return data as RouterPoolRow[]
    })

    const price = deriveBuyTokenPriceUsd(body.fromAmountUsd, lifiBuyAmount, body.buyTokenDecimals)
    const publicClient = createPublicClient({ transport: http(cfg.rpcUrl) })
    const reader = createQuoterReader(viemQuoteSimulate(publicClient, cfg.quoter), {
      tokenIn: body.tokenIn,
      buyTokenDecimals: body.buyTokenDecimals,
      buyTokenPriceUsd: price,
      gasCostUsd: body.lifiGasCostUsd, // LI.FI gas as a conservative internal proxy
    })

    try {
      const decision = await resolveSwapRoute({
        chainId: body.chainId,
        tokenIn: body.tokenIn,
        tokenOut: body.tokenOut,
        amountIn,
        lifi: { buyAmount: lifiBuyAmount, gasCostUsd: body.lifiGasCostUsd },
        registry,
        reader,
        enabled: true,
        sharedBuyTokenPriceUsd: price ?? undefined,
      })
      // ctx.json is BigInt-safe: NetQuote.buyAmount serializes to a string.
      return ctx.json(decision)
    } catch (err) {
      ctx.log.warn('swap/best-route', 'resolve failed — falling back to LI.FI', { error: String(err) })
      return ctx.json(lifiOnly('lifi-internal-unavailable'))
    }
  },
  { rateLimit: { max: 30, windowMs: 60_000 } },
)

// POST /api/swap/quote
// Server-side LI.FI `/quote` proxy. Two jobs, both security-critical:
//   1. Hide the API key — the key lives in server-only `LIFI_API_KEY`, never the bundle.
//   2. Inject the platform fee SERVER-SIDE so the client cannot strip it.
// Returns LI.FI's raw `/quote` JSON (estimate + transactionRequest) unchanged, so the
// client parser in lib/web2/providers/lifi.ts consumes it exactly as before.
// Auth: none (rate-limited to protect the key/quota).

import { createHandler } from '@/lib/web2/routeHandler'
import { TREASURY_ADDRESS } from '@/lib/constants'

const LIFI_QUOTE_URL = 'https://li.quest/v1/quote'
const LIFI_FEE       = 0.005  // 0.5% — the ONLY fee source; client input is ignored
const INTEGRATOR     = process.env.LIFI_INTEGRATOR || process.env.NEXT_PUBLIC_LIFI_INTEGRATOR || 'mintware'

interface QuoteBody {
  chainId: number; sellToken: string; buyToken: string
  sellAmount: string; taker: string
}

function validateBody(b: unknown): b is QuoteBody {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.chainId === 'number' &&
    typeof p.sellToken === 'string' && p.sellToken.length > 0 &&
    typeof p.buyToken === 'string' && p.buyToken.length > 0 &&
    typeof p.sellAmount === 'string' && p.sellAmount.length > 0 &&
    typeof p.taker === 'string' && (p.taker as string).startsWith('0x')
  )
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.json() } catch { return ctx.json({ error: 'invalid json' }, 400) }

  if (!validateBody(body)) {
    return ctx.json({ error: 'missing or invalid fields', required: ['chainId', 'sellToken', 'buyToken', 'sellAmount', 'taker'] }, 422)
  }

  const treasury = TREASURY_ADDRESS || process.env.NEXT_PUBLIC_MINTWARE_TREASURY

  // Same-chain swap: fromChain === toChain, so LI.FI never bridges — no bridge
  // param is needed. (A prior `allowBridges: 'false'` was invalid: LI.FI parses
  // it as the array ['false'], which is not a valid bridge name → 400 code 1011.)
  const qp = new URLSearchParams({
    fromChain:    String(body.chainId),
    toChain:      String(body.chainId),
    fromToken:    body.sellToken,
    toToken:      body.buyToken,
    fromAmount:   body.sellAmount,
    fromAddress:  body.taker,
    integrator:   INTEGRATOR,
  })

  // Fee is injected here, server-side, and CANNOT be removed by the client.
  // LI.FI only honors `fee` for a verified integrator — gated on the same env
  // var (`NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED`) as before, or quotes 4xx.
  if (treasury && process.env.NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED === 'true') {
    qp.set('fee', LIFI_FEE.toFixed(6))
    qp.set('referrer', treasury)
  }

  try {
    const upstream = await fetch(`${LIFI_QUOTE_URL}?${qp.toString()}`, {
      headers: { Accept: 'application/json', 'x-lifi-api-key': process.env.LIFI_API_KEY ?? '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    const data = await upstream.json()

    // Record the SERVER-computed quote so the reward path can trust the USD value later instead of
    // the client (audit HIGH #6/#7). We persist LI.FI's estimate.fromAmountUSD keyed by a quote_id
    // and hand the id back to the client, which threads it into /api/campaigns/swap-event. Best
    // effort: a persistence failure never blocks the swap — the reward path just falls back to the
    // capped client value + existing caps.
    if (upstream.ok) {
      const fromAmountUsd = Number((data as { estimate?: { fromAmountUSD?: string } })?.estimate?.fromAmountUSD)
      if (Number.isFinite(fromAmountUsd) && fromAmountUsd > 0) {
        try {
          const { data: row, error } = await ctx.supabase
            .from('swap_quotes')
            .insert({
              wallet:      body.taker.toLowerCase(),
              chain_id:    body.chainId,
              sell_token:  body.sellToken,
              buy_token:   body.buyToken,
              sell_amount: body.sellAmount,
              amount_usd:  fromAmountUsd,
              fee_bps:     LIFI_FEE * 10_000, // 0.005 → 50 bps
              referrer:    treasury ?? null,
              expires_at:  new Date(Date.now() + 30 * 60_000).toISOString(), // 30-min TTL
            })
            .select('id')
            .single()
          if (error) {
            ctx.log.warn('swap/quote', 'quote persist failed (non-fatal)', { error: error.message })
          } else if (row?.id) {
            // Attach the id to the returned JSON WITHOUT disturbing LI.FI's shape.
            ;(data as Record<string, unknown>).mw_quote_id = row.id
          }
        } catch (persistErr) {
          ctx.log.warn('swap/quote', 'quote persist threw (non-fatal)', { error: String(persistErr) })
        }
      }
    }

    return ctx.json(data, upstream.status)
  } catch (err) {
    ctx.log.error('swap/quote', 'upstream error', { error: String(err) })
    return ctx.json({ error: 'quote failed', message: err instanceof Error ? err.message : 'unknown' }, 502)
  }
}, { rateLimit: { max: 20, windowMs: 60_000 } }) // protect the LI.FI key/quota from cost abuse

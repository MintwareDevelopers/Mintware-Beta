// POST /api/swap/quote
// Server-side LI.FI route proxy — hides API key, enforces fee injection.
// Auth: none

import { createHandler } from '@/lib/web2/routeHandler'
import { TREASURY_ADDRESS } from '@/lib/constants'

const LIFI_ROUTES_URL = 'https://li.quest/v1/advanced/routes'
const LIFI_FEE        = 0.005  // 0.5%

interface QuoteRequest {
  fromChainId: number; toChainId: number; fromTokenAddress: string
  toTokenAddress: string; fromAmount: string; fromAddress: string
  options?: { slippage?: number; [key: string]: unknown }
}

function validateBody(b: unknown): b is QuoteRequest {
  if (!b || typeof b !== 'object') return false
  const p = b as Record<string, unknown>
  return (
    typeof p.fromChainId === 'number' && typeof p.toChainId === 'number' &&
    typeof p.fromTokenAddress === 'string' && p.fromTokenAddress.length > 0 &&
    typeof p.toTokenAddress === 'string' && p.toTokenAddress.length > 0 &&
    typeof p.fromAmount === 'string' && p.fromAmount.length > 0 &&
    typeof p.fromAddress === 'string' && (p.fromAddress as string).startsWith('0x')
  )
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try { body = await req.clone().json() } catch { return ctx.json({ error: 'invalid json' }, 400) }

  if (!validateBody(body)) {
    return ctx.json({ error: 'missing or invalid fields', required: ['fromChainId', 'toChainId', 'fromTokenAddress', 'toTokenAddress', 'fromAmount', 'fromAddress'] }, 422)
  }

  const treasury = TREASURY_ADDRESS || process.env.NEXT_PUBLIC_MINTWARE_TREASURY

  const lifiReq = {
    fromChainId: body.fromChainId, toChainId: body.toChainId,
    fromTokenAddress: body.fromTokenAddress, toTokenAddress: body.toTokenAddress,
    fromAmount: body.fromAmount, fromAddress: body.fromAddress,
    options: {
      slippage: body.options?.slippage ?? 0.01,
      ...(treasury && process.env.NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED === 'true'
        ? { fee: LIFI_FEE, referrer: treasury } : {}),
    },
  }

  try {
    const upstream = await fetch(LIFI_ROUTES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lifi-api-key': process.env.LIFI_API_KEY ?? '' },
      body: JSON.stringify(lifiReq),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await upstream.json()
    return ctx.json(data, upstream.status)
  } catch (err) {
    ctx.log.error('swap/quote', 'upstream error', { error: String(err) })
    return ctx.json({ error: 'quote failed', message: err instanceof Error ? err.message : 'unknown' }, 502)
  }
}, { rateLimit: { max: 20, windowMs: 60_000 } }) // protect the LI.FI key/quota from cost abuse

// =============================================================================
// POST /api/swap/quote
//
// Server-side LI.FI route proxy.
//
// Why this exists:
//   1. Hides LIFI_API_KEY — moves it from NEXT_PUBLIC_ (client bundle) to
//      server-only. Prevents API key scraping and quota theft.
//   2. Enforces fee + referrer server-side — even if a client intercepts the
//      route object and strips fee params before executeRoute(), the on-chain
//      tx verification in /api/campaigns/swap-event will reject the swap event
//      if the treasury address is missing from calldata.
//
// The returned route object is passed directly to LI.FI SDK's executeRoute()
// on the client — execution doesn't require an API key.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'

const LIFI_ROUTES_URL = 'https://li.quest/v1/advanced/routes'
const LIFI_FEE        = 0.005  // 0.5% integrator fee

// Accept required fields only — fee/referrer are always injected server-side
interface QuoteRequest {
  fromChainId:       number
  toChainId:         number
  fromTokenAddress:  string
  toTokenAddress:    string
  fromAmount:        string
  fromAddress:       string
  options?: {
    slippage?: number
    [key: string]: unknown
  }
}

function validateBody(body: unknown): body is QuoteRequest {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.fromChainId      === 'number' &&
    typeof b.toChainId        === 'number' &&
    typeof b.fromTokenAddress === 'string' && b.fromTokenAddress.length > 0 &&
    typeof b.toTokenAddress   === 'string' && b.toTokenAddress.length > 0 &&
    typeof b.fromAmount       === 'string' && b.fromAmount.length > 0 &&
    typeof b.fromAddress      === 'string' && b.fromAddress.startsWith('0x')
  )
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!validateBody(body)) {
    return NextResponse.json(
      {
        error:    'missing or invalid fields',
        required: ['fromChainId', 'toChainId', 'fromTokenAddress', 'toTokenAddress', 'fromAmount', 'fromAddress'],
      },
      { status: 422 }
    )
  }

  const treasury = process.env.MINTWARE_TREASURY_ADDRESS ?? process.env.NEXT_PUBLIC_MINTWARE_TREASURY

  // Build LI.FI request — always inject fee + referrer
  const lifiReq = {
    fromChainId:      body.fromChainId,
    toChainId:        body.toChainId,
    fromTokenAddress: body.fromTokenAddress,
    toTokenAddress:   body.toTokenAddress,
    fromAmount:       body.fromAmount,
    fromAddress:      body.fromAddress,
    options: {
      // Allow slippage passthrough; strip any client-supplied fee/referrer
      slippage: body.options?.slippage ?? 0.01,
      // Server-enforced — always present when integrator is verified
      ...(treasury && process.env.NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED === 'true'
        ? { fee: LIFI_FEE, referrer: treasury }
        : {}),
    },
  }

  try {
    const upstream = await fetch(LIFI_ROUTES_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-lifi-api-key': process.env.LIFI_API_KEY ?? '',
      },
      body:   JSON.stringify(lifiReq),
      signal: AbortSignal.timeout(15_000),
    })

    const data = await upstream.json()
    return NextResponse.json(data, { status: upstream.status })
  } catch (err) {
    console.error('[swap/quote] upstream error:', err)
    return NextResponse.json(
      { error: 'quote failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
}

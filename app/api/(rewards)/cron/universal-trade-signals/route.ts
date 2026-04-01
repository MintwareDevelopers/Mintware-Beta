import { NextRequest, NextResponse } from 'next/server'
import { syncTradeSignals } from '@/lib/rewards/universal/indexer'

export const dynamic = 'force-dynamic'

function authorize(req: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    return null
  }

  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'CRON_SECRET not set — refusing to run outside local development' },
      { status: 500 }
    )
  }

  return null
}

export async function GET(req: NextRequest) {
  const authFailure = authorize(req)
  if (authFailure) return authFailure

  const chainSlug = process.env.UNIVERSAL_TRADE_SIGNAL_CHAIN ?? 'base_sepolia'
  const contractAddress = process.env.UNIVERSAL_TRADE_SIGNAL_HOOK_ADDRESS as `0x${string}` | undefined

  if (!contractAddress) {
    return NextResponse.json(
      { error: 'UNIVERSAL_TRADE_SIGNAL_HOOK_ADDRESS not set' },
      { status: 500 }
    )
  }

  const initialWindow = process.env.UNIVERSAL_TRADE_SIGNAL_INITIAL_BLOCK_WINDOW
    ? BigInt(process.env.UNIVERSAL_TRADE_SIGNAL_INITIAL_BLOCK_WINDOW)
    : undefined
  const confirmations = process.env.UNIVERSAL_TRADE_SIGNAL_CONFIRMATIONS
    ? BigInt(process.env.UNIVERSAL_TRADE_SIGNAL_CONFIRMATIONS)
    : undefined

  try {
    const result = await syncTradeSignals({
      chainSlug,
      contractAddress,
      initialWindow,
      confirmations,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[cron/universal-trade-signals] sync failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

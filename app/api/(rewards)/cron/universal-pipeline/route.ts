import { NextRequest, NextResponse } from 'next/server'
import { syncTradeSignals } from '@/lib/rewards/universal/indexer'
import { settleUniversalEpochs } from '@/lib/rewards/universal/settler'
import { bridgeUniversalEpochsToDistributor } from '@/lib/rewards/universal/bridgeCron'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, nested) => (typeof nested === 'bigint' ? nested.toString() : nested))
  ) as T
}

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
  const initialWindow = process.env.UNIVERSAL_TRADE_SIGNAL_INITIAL_BLOCK_WINDOW
    ? BigInt(process.env.UNIVERSAL_TRADE_SIGNAL_INITIAL_BLOCK_WINDOW)
    : undefined
  const confirmations = process.env.UNIVERSAL_TRADE_SIGNAL_CONFIRMATIONS
    ? BigInt(process.env.UNIVERSAL_TRADE_SIGNAL_CONFIRMATIONS)
    : undefined
  const bridgeLimit = Number(process.env.UNIVERSAL_DISTRIBUTION_BRIDGE_LIMIT ?? 25)

  if (!contractAddress) {
    return NextResponse.json(
      { error: 'UNIVERSAL_TRADE_SIGNAL_HOOK_ADDRESS not set' },
      { status: 500 }
    )
  }

  try {
    const sync = await syncTradeSignals({
      chainSlug,
      contractAddress,
      initialWindow,
      confirmations,
    })

    const settle = await settleUniversalEpochs()
    const bridge = await bridgeUniversalEpochsToDistributor(bridgeLimit)

    return NextResponse.json(jsonSafe({
      ok: true,
      sync,
      settle,
      bridge,
    }))
  } catch (error) {
    console.error('[cron/universal-pipeline] pipeline failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { syncTradeSignals } from '@/lib/rewards/universal/indexer'

export const dynamic = 'force-dynamic'

export const GET = createHandler(async (_req, ctx) => {
  const chainSlug       = process.env.UNIVERSAL_TRADE_SIGNAL_CHAIN ?? 'base_sepolia'
  const contractAddress = process.env.UNIVERSAL_TRADE_SIGNAL_HOOK_ADDRESS as `0x${string}` | undefined

  if (!contractAddress) {
    ctx.log.error('universal-trade-signals', 'UNIVERSAL_TRADE_SIGNAL_HOOK_ADDRESS not set')
    return NextResponse.json(
      { success: false, error: 'UNIVERSAL_TRADE_SIGNAL_HOOK_ADDRESS not set' },
      { status: 500 }
    )
  }

  const initialWindow = process.env.UNIVERSAL_TRADE_SIGNAL_INITIAL_BLOCK_WINDOW
    ? BigInt(process.env.UNIVERSAL_TRADE_SIGNAL_INITIAL_BLOCK_WINDOW)
    : undefined
  const confirmations = process.env.UNIVERSAL_TRADE_SIGNAL_CONFIRMATIONS
    ? BigInt(process.env.UNIVERSAL_TRADE_SIGNAL_CONFIRMATIONS)
    : undefined

  ctx.log.info('universal-trade-signals', 'Sync started', { chainSlug, contractAddress })
  const result = await syncTradeSignals({ chainSlug, contractAddress, initialWindow, confirmations })
  ctx.log.info('universal-trade-signals', 'Sync complete', result as unknown as Record<string, unknown>)

  return ctx.json({ ok: true, ...result })
}, { auth: 'bearer-token' })

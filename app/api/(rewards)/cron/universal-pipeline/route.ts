import { NextResponse } from 'next/server'
import { createHandler } from '@/lib/web2/routeHandler'
import { syncTradeSignals } from '@/lib/rewards/universal/indexer'
import { settleUniversalEpochs } from '@/lib/rewards/universal/settler'
import { bridgeUniversalEpochsToDistributor } from '@/lib/rewards/universal/bridgeCron'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = createHandler(async (_req, ctx) => {
  const chainSlug       = process.env.UNIVERSAL_TRADE_SIGNAL_CHAIN ?? 'base_sepolia'
  const contractAddress = process.env.UNIVERSAL_TRADE_SIGNAL_HOOK_ADDRESS as `0x${string}` | undefined
  const bridgeLimit     = Number(process.env.UNIVERSAL_DISTRIBUTION_BRIDGE_LIMIT ?? 25)

  if (!contractAddress) {
    ctx.log.error('universal-pipeline', 'UNIVERSAL_TRADE_SIGNAL_HOOK_ADDRESS not set')
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

  ctx.log.info('universal-pipeline', 'Pipeline started', { chainSlug, contractAddress, bridgeLimit })

  const sync   = await syncTradeSignals({ chainSlug, contractAddress, initialWindow, confirmations })
  const settle = await settleUniversalEpochs()
  const bridge = await bridgeUniversalEpochsToDistributor(bridgeLimit)

  ctx.log.info('universal-pipeline', 'Pipeline complete')
  return ctx.json({ ok: true, sync, settle, bridge })
}, { auth: 'bearer-token' })

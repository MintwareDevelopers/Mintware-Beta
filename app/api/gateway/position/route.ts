import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { marketEnginePublicClient } from '@/lib/gateway/chain'
import { marketEngineConfigForPool, resolveMarketEngine } from '@/lib/gateway/marketEngine'
import { MARKET_ENGINE_ABI } from '@/lib/web3/artifacts/marketEngine'
import { createTokenBucket } from '@/lib/gateway/sparkline'
import { computeCostBasis, type EngineEvent } from '@/lib/gateway/costBasis'

export const dynamic = 'force-dynamic'
const ipBucket = createTokenBucket({ capacity: 30, refillPerSec: 0.5, maxKeys: 5_000 })

export const GET = createHandler(async (req, ctx) => {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown'
  if (!ipBucket.take(ip)) return ctx.json({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
  let cfg
  try { cfg = await marketEngineConfigForPool(ctx.supabase, req.nextUrl.searchParams.get('pool')) }
  catch { return ctx.json({ success: false, error: 'engine_registry_unavailable' }, 503) }
  if (!cfg) return ctx.json({ success: false, error: 'market_engine_not_configured' }, 503)
  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  if (!address || !isAddress(address)) return ctx.json({ success: false, error: 'address_required' }, 400)
  let inst
  try { inst = await resolveMarketEngine(ctx.supabase, cfg, req.nextUrl.searchParams.get('pool'), true, req.nextUrl.searchParams.get('pm')) }
  catch (e) {
    ctx.log.warn('market-engine.position', 'engine registry unavailable', { error: String(e) })
    return ctx.json({ success: false, error: 'engine_registry_unavailable' }, 503)
  }
  if (!inst || !inst.verified) return ctx.json({ success: false, error: 'pool_not_live' }, 404)
  try {
    const client = marketEnginePublicClient(cfg)
    const [shares, totalSupply, totalNav] = await Promise.all([
      client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] }),
      client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'totalSupply' }).catch(() => null),
      client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'totalNav' }).catch(() => null),
    ])
    const valuationAvailable = totalSupply !== null && totalNav !== null
    const value = !valuationAvailable ? null : BigInt(totalSupply) === 0n ? 0n : BigInt(shares) * BigInt(totalNav) / BigInt(totalSupply)
    // "Put in" is rebuilt from the receipt-verified events (lib/gateway/costBasis.ts); a read failure or any
    // mismatch with on-chain shares reports it as unavailable rather than guessing.
    const { data: rows, error: eventsError } = await ctx.supabase.from('market_engine_tx_events')
      .select('action, shares_atomic, amount0_atomic, amount1_atomic, block_number, transaction_index')
      .eq('user_wallet', address).eq('pool_address', inst.poolAddress).eq('chain_id', inst.chainId).eq('market_engine_address', inst.engineAddress)
    const events: EngineEvent[] = (rows ?? []).map((r: Record<string, unknown>) => ({
      action: r.action === 'withdraw' ? 'withdraw' : 'deposit',
      sharesAtomic: BigInt(String(r.shares_atomic)),
      amount0Atomic: BigInt(String(r.amount0_atomic ?? '0')),
      amount1Atomic: BigInt(String(r.amount1_atomic ?? '0')),
      blockNumber: BigInt(String(r.block_number)),
      txIndex: Number(r.transaction_index),
    }))
    const quoteSideKnown = Boolean(inst.quoteAsset && inst.token0)
    const quoteIs0 = quoteSideKnown && inst.quoteAsset.toLowerCase() === inst.token0.toLowerCase()
    const basis = eventsError || !quoteSideKnown ? { basisAtomic: null, complete: false } : computeCostBasis(events, BigInt(shares), quoteIs0)
    const pnl = basis.basisAtomic !== null && value !== null ? value - basis.basisAtomic : null
    return ctx.json({ success: true, position: { shares: String(shares), positionValueAtomic: value?.toString() ?? null, costBasisAtomic: basis.basisAtomic?.toString() ?? null, unrealizedPnlAtomic: pnl?.toString() ?? null, recorded: events.length > 0, costBasisComplete: basis.complete, sourceReadable: true, valuationAvailable, history: [] }, poolState: null, totalNav: totalNav?.toString() ?? null, totalSupply: totalSupply?.toString() ?? null, source: inst.source, live: inst.live })
  } catch (e) {
    ctx.log.warn('market-engine.position', 'chain read failed', { error: String(e) })
    return ctx.json({ success: false, error: 'chain_read_failed' }, 502)
  }
})

export const POST = createHandler(async (_req, ctx) => ctx.json({ success: false, error: 'buffer_not_supported' }, 410), { auth: 'signed-message', action: 'mintware-gateway-buffer' })
